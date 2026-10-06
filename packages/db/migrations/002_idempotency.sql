-- =============================================================================
-- Migration 002 — Idempotency & Rate-Limit Infrastructure
-- Adds: idempotency_keys table, rate_limit_buckets table, Redis snapshot refs
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- idempotency_keys
-- Explicit idempotency store — server checks this BEFORE processing any intent
-- that touches the ledger. Prevents replays even across server restarts.
-- ---------------------------------------------------------------------------

CREATE TABLE idempotency_keys (
  idem_key        TEXT        PRIMARY KEY,
  account_id      UUID        NOT NULL REFERENCES accounts(id),
  intent_type     TEXT        NOT NULL,      -- e.g. 'BUY', 'SELL', 'PAY_BRIBE'
  -- Stored response so replayed requests get the same answer
  response_code   TEXT        NOT NULL,      -- 'OK' or error code
  response_body   JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- TTL: keys older than 24 h can be pruned by a maintenance job
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_idem_keys_account_id  ON idempotency_keys (account_id, created_at DESC);
CREATE INDEX idx_idem_keys_expires_at  ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------
-- rate_limit_buckets
-- Persistent rate-limit state for server-side enforcement.
-- Redis holds the hot-path; this table is the crash-recovery fallback.
-- ---------------------------------------------------------------------------

CREATE TABLE rate_limit_buckets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bucket_key      TEXT        NOT NULL,      -- e.g. 'intent:BUY', 'talk:npc'
  -- Token-bucket state
  tokens          INTEGER     NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  last_refill_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Max tokens (configured by server, stored here for reference)
  capacity        INTEGER     NOT NULL DEFAULT 60,
  -- Refill rate: tokens per second
  refill_rate     NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (account_id, bucket_key)
);

CREATE INDEX idx_rate_limit_account ON rate_limit_buckets (account_id);

CREATE TRIGGER trg_rate_limit_updated_at
  BEFORE UPDATE ON rate_limit_buckets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- crash_recovery_snapshots
-- Colyseus room state snapshots stored for crash recovery.
-- Redis holds the live copy; this is the durable fallback.
-- ---------------------------------------------------------------------------

CREATE TABLE crash_recovery_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         TEXT        NOT NULL,
  pack_id         TEXT        NOT NULL REFERENCES city_packs(pack_id),
  -- Full Colyseus room state as compressed JSONB
  state_snapshot  JSONB       NOT NULL,
  tick            BIGINT      NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only keep the latest snapshot per room (older ones pruned by maintenance)
CREATE INDEX idx_snapshots_room_id ON crash_recovery_snapshots (room_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- View: current player balances (reconciled from ledger)
-- Used for consistency checks — the players.balance_kobo column is the cache.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_player_balances AS
SELECT
  p.id                AS player_id,
  p.account_id,
  p.pack_id,
  p.balance_kobo      AS cached_balance_kobo,
  COALESCE(
    SUM(
      CASE le.direction
        WHEN 'CREDIT' THEN  le.amount_kobo
        WHEN 'DEBIT'  THEN -le.amount_kobo
      END
    ), 0
  )                   AS ledger_balance_kobo,
  -- Flag any discrepancy for reconciliation jobs
  (p.balance_kobo != COALESCE(
    SUM(
      CASE le.direction
        WHEN 'CREDIT' THEN  le.amount_kobo
        WHEN 'DEBIT'  THEN -le.amount_kobo
      END
    ), 0
  ))                  AS balance_discrepancy
FROM players p
LEFT JOIN ledger_entries le
  ON le.player_id = p.id
GROUP BY p.id, p.account_id, p.pack_id, p.balance_kobo;

-- ---------------------------------------------------------------------------
-- Prune function for expired idempotency keys (run via pg_cron or cron job)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prune_expired_idempotency_keys()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM idempotency_keys
  WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMIT;
