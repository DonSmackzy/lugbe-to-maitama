-- =============================================================================
-- Migration 001 — Initial Schema
-- Game: Lugbe to Maitama
-- Rule: All monetary values stored as INTEGER kobo. Never floats.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extension: UUID generation
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- ENUM types
-- ---------------------------------------------------------------------------

CREATE TYPE ledger_direction AS ENUM ('CREDIT', 'DEBIT');

CREATE TYPE ledger_kind AS ENUM (
  'PURCHASE',
  'SALE',
  'BRIBE',
  'RENT',
  'GOVERNMENT_FEE',
  'STARTING_GRANT',
  'PENALTY',
  'REWARD'
);

CREATE TYPE file_status AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED'
);

-- ---------------------------------------------------------------------------
-- accounts
-- One row per authenticated user (auth provider agnostic)
-- ---------------------------------------------------------------------------

CREATE TABLE accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     TEXT        NOT NULL UNIQUE,      -- e.g. Firebase UID / Clerk sub
  display_name    TEXT        NOT NULL,
  email           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  banned_at       TIMESTAMPTZ,
  ban_reason      TEXT
);

CREATE INDEX idx_accounts_external_id ON accounts (external_id);

-- ---------------------------------------------------------------------------
-- city_packs
-- Catalog of installed city packs (records which packs the server knows about)
-- ---------------------------------------------------------------------------

CREATE TABLE city_packs (
  pack_id         TEXT        PRIMARY KEY,          -- e.g. 'abuja_v1' — must match CityPack.packId
  display_name    TEXT        NOT NULL,
  schema_version  TEXT        NOT NULL,
  pack_json       JSONB       NOT NULL,             -- full validated JSON blob
  active          BOOLEAN     NOT NULL DEFAULT true,
  installed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- players
-- One row per account per city pack (a player may have one save per pack)
-- ---------------------------------------------------------------------------

CREATE TABLE players (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pack_id             TEXT        NOT NULL REFERENCES city_packs(pack_id),
  -- Position on city grid
  pos_x               INTEGER     NOT NULL DEFAULT 0,
  pos_y               INTEGER     NOT NULL DEFAULT 0,
  district_id         TEXT,
  -- Authoritative wallet balance (kobo integer — derived from ledger, cached for reads)
  balance_kobo        BIGINT      NOT NULL DEFAULT 0 CHECK (balance_kobo >= 0),
  social_capital      INTEGER     NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ,

  UNIQUE (account_id, pack_id)
);

CREATE INDEX idx_players_account_id ON players (account_id);
CREATE INDEX idx_players_pack_id    ON players (pack_id);

-- ---------------------------------------------------------------------------
-- inventory
-- Player item holdings
-- ---------------------------------------------------------------------------

CREATE TABLE inventory (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  pack_id     TEXT        NOT NULL REFERENCES city_packs(pack_id),
  item_id     TEXT        NOT NULL,   -- must exist in city_packs.pack_json->>'items'
  quantity    INTEGER     NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (player_id, item_id)
);

CREATE INDEX idx_inventory_player_id ON inventory (player_id);

-- ---------------------------------------------------------------------------
-- ledger_entries  (APPEND ONLY — never UPDATE or DELETE rows here)
-- The financial source of truth. Every monetary event is recorded here.
-- ---------------------------------------------------------------------------

CREATE TABLE ledger_entries (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID            NOT NULL REFERENCES accounts(id),
  player_id           UUID            REFERENCES players(id),        -- nullable: pre-player grants
  pack_id             TEXT            REFERENCES city_packs(pack_id),
  kind                ledger_kind     NOT NULL,
  direction           ledger_direction NOT NULL,
  -- Amount is ALWAYS positive; direction determines sign
  amount_kobo         BIGINT          NOT NULL CHECK (amount_kobo > 0),
  -- Idempotency key — prevents double-processing of the same intent
  idem_key            TEXT            NOT NULL UNIQUE,
  related_entity_id   TEXT,           -- item_id, npc_instance_id, etc.
  -- Running balance snapshot (computed by server on write for fast reads)
  balance_after_kobo  BIGINT          NOT NULL CHECK (balance_after_kobo >= 0),
  metadata            JSONB,          -- arbitrary extra context
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
  -- NO updated_at — this table is append-only
);

-- Prevent any UPDATE or DELETE on ledger_entries
CREATE RULE ledger_no_update AS ON UPDATE TO ledger_entries DO INSTEAD NOTHING;
CREATE RULE ledger_no_delete AS ON DELETE TO ledger_entries DO INSTEAD NOTHING;

CREATE INDEX idx_ledger_account_id  ON ledger_entries (account_id, created_at DESC);
CREATE INDEX idx_ledger_player_id   ON ledger_entries (player_id, created_at DESC);
CREATE INDEX idx_ledger_idem_key    ON ledger_entries (idem_key);

-- ---------------------------------------------------------------------------
-- bureaucracy_files
-- Tracks the state of each player's bureaucratic processes
-- ---------------------------------------------------------------------------

CREATE TABLE bureaucracy_files (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  pack_id             TEXT        NOT NULL REFERENCES city_packs(pack_id),
  rule_id             TEXT        NOT NULL,      -- bureaucracy_rule.id from pack
  status              file_status NOT NULL DEFAULT 'PENDING',
  -- Game tick when this was submitted and when it resolves
  submitted_tick      BIGINT      NOT NULL,
  resolves_tick       BIGINT      NOT NULL,
  -- Ledger entry that captured the filing fee
  fee_ledger_entry_id UUID        REFERENCES ledger_entries(id),
  -- Items attached to this file (JSONB array of item_ids)
  attached_item_ids   JSONB       NOT NULL DEFAULT '[]',
  rejection_reason    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bureau_files_player_id ON bureaucracy_files (player_id);
CREATE INDEX idx_bureau_files_status    ON bureaucracy_files (status) WHERE status = 'PENDING';

-- ---------------------------------------------------------------------------
-- audit_log
-- Immutable record of all sensitive server-side events for anti-cheat + ops
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id          BIGSERIAL   PRIMARY KEY,
  event_type  TEXT        NOT NULL,   -- e.g. 'INTENT_REJECTED', 'PLAYER_BANNED'
  account_id  UUID        REFERENCES accounts(id),
  player_id   UUID        REFERENCES players(id),
  room_id     TEXT,
  payload     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_account_id  ON audit_log (account_id, created_at DESC);
CREATE INDEX idx_audit_log_event_type  ON audit_log (event_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at trigger (shared function)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_players_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bureau_files_updated_at
  BEFORE UPDATE ON bureaucracy_files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
