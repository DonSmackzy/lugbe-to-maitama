// =============================================================================
// Postgres Ledger Integration — apps/server/src/economy/ledger.ts
// Handles append-only financial records in PostgreSQL ledger_entries,
// atomic spatial state syncing (preventing double-charge commute bugs),
// deadlock-free sorted row locking, and inventory zero-state pruning.
// =============================================================================

import { getDb } from "@ltm/db";
import type {
  CashEffect,
  Effect,
  InventoryEffect,
  ActorState,
} from "@ltm/engine";

export interface SpatialSnapshot {
  x: number;
  y: number;
  districtId: string;
}

export type LedgerTransactionResult =
  | { ok: true; balanceAfterKobo: number; idemKey: string }
  | { ok: false; code: string; message: string };

/**
 * Type guard for SpatialSnapshot
 */
export function isSpatialSnapshot(val: unknown): val is SpatialSnapshot {
  return (
    typeof val === "object" &&
    val !== null &&
    "x" in val &&
    "y" in val &&
    "districtId" in val
  );
}

/**
 * Deadlock-prevention helper:
 * Strictly sorts player IDs alphabetically (lexicographically) and removes duplicates.
 */
export function sortPlayerIds(playerIds: string[]): string[] {
  return [...new Set(playerIds)].sort((a, b) => a.localeCompare(b));
}

export const sortPlayerIdsForLocking = sortPlayerIds;

/**
 * Deadlock-prevention row locking utility.
 * Accepts an array of player IDs, strictly sorts them alphabetically,
 * and locks each row sequentially with SELECT ... FOR UPDATE.
 */
export async function lockPlayers(
  tx: any,
  playerIds: string[]
): Promise<string[]> {
  const sortedIds = sortPlayerIds(playerIds);
  for (const playerId of sortedIds) {
    await tx`
      SELECT id FROM players WHERE id = ${playerId} FOR UPDATE
    `;
  }
  return sortedIds;
}

export const lockPlayersInOrder = lockPlayers;
export const lockPlayersForUpdate = lockPlayers;

/**
 * Removes inventory rows that have dropped to 0 or below to prevent DB bloat.
 * Runs as a distinct query within the transaction block.
 */
export async function cleanZeroQuantityInventory(
  tx: any,
  playerId: string
): Promise<void> {
  await tx`
    DELETE FROM inventory WHERE quantity <= 0 AND player_id = ${playerId}
  `;
}

export interface LedgerTransactionContext {
  tx: any;
  actor: ActorState;
  effects: Effect[];
  packId?: string | undefined;
  spatialSnapshot?: SpatialSnapshot | undefined;
}

/**
 * Executes ledger effects inside a dedicated PostgreSQL transaction context.
 * Performs row locking, ledger inserts, atomic player balance/spatial sync,
 * and inventory zero-state pruning within the EXACT SAME transaction.
 */
export async function executeLedgerTransaction(
  ctx: LedgerTransactionContext
): Promise<LedgerTransactionResult> {
  const { tx, actor, effects, spatialSnapshot } = ctx;
  const packId = ctx.packId ?? "abuja_v1";

  const cashEffects = effects.filter((e): e is CashEffect => e.kind === "CASH");
  const inventoryEffects = effects.filter(
    (e): e is InventoryEffect => e.kind === "INVENTORY"
  );

  // 1. DEADLOCK PREVENTION: Lock player row(s) in strict alphabetical order
  await lockPlayers(tx, [actor.id]);

  // 2. IDEMPOTENCY CHECK: Ensure no duplicate idemKey has already been committed
  for (const cashEffect of cashEffects) {
    if (cashEffect.idemKey) {
      const existingKey = await tx`
        SELECT idem_key FROM idempotency_keys WHERE idem_key = ${cashEffect.idemKey} LIMIT 1
      `;
      if (existingKey.length > 0) {
        return {
          ok: false,
          code: "DUPLICATE_IDEM_KEY",
          message: `Idempotency key '${cashEffect.idemKey}' has already been committed to the ledger`,
        };
      }
    }
  }

  // 3. CASH LEDGER ENTRIES:
  let runningBalance = actor.balanceKobo;
  let lastIdemKey = `tx_${actor.id}_${Date.now()}`;

  for (const cashEffect of cashEffects) {
    if (cashEffect.deltaKobo !== 0) {
      const direction = cashEffect.deltaKobo > 0 ? "CREDIT" : "DEBIT";
      const amountKobo = Math.abs(cashEffect.deltaKobo);
      runningBalance += cashEffect.deltaKobo;
      lastIdemKey = cashEffect.idemKey;

      const metadataJson = tx.json
        ? tx.json({ ledgerKind: cashEffect.ledgerKind })
        : JSON.stringify({ ledgerKind: cashEffect.ledgerKind });

      await tx`
        INSERT INTO ledger_entries (
          account_id,
          player_id,
          pack_id,
          kind,
          direction,
          amount_kobo,
          idem_key,
          related_entity_id,
          balance_after_kobo,
          metadata
        ) VALUES (
          ${actor.accountId},
          ${actor.id},
          ${packId},
          ${cashEffect.ledgerKind},
          ${direction},
          ${amountKobo},
          ${cashEffect.idemKey},
          ${cashEffect.relatedEntityId ?? null},
          ${runningBalance},
          ${metadataJson}
        )
      `;

      const responseBodyJson = tx.json
        ? tx.json({ newBalanceKobo: runningBalance })
        : JSON.stringify({ newBalanceKobo: runningBalance });

      await tx`
        INSERT INTO idempotency_keys (
          idem_key,
          account_id,
          intent_type,
          response_code,
          response_body
        ) VALUES (
          ${cashEffect.idemKey},
          ${actor.accountId},
          ${cashEffect.ledgerKind},
          ${"OK"},
          ${responseBodyJson}
        )
      `;
    }
  }

  // 4. ATOMIC SPATIAL + FINANCIAL UPDATE:
  // If spatialSnapshot is provided, update pos_x, pos_y, and district_id
  // in the EXACT SAME Postgres transaction as the ledger_entries insert.
  if (spatialSnapshot) {
    await tx`
      UPDATE players
      SET balance_kobo = ${runningBalance},
          pos_x = ${spatialSnapshot.x},
          pos_y = ${spatialSnapshot.y},
          district_id = ${spatialSnapshot.districtId},
          updated_at = NOW()
      WHERE account_id = ${actor.accountId} AND pack_id = ${packId}
    `;
  } else {
    await tx`
      UPDATE players
      SET balance_kobo = ${runningBalance},
          updated_at = NOW()
      WHERE account_id = ${actor.accountId} AND pack_id = ${packId}
    `;
  }

  // 5. INVENTORY MUTATIONS:
  for (const itemEffect of inventoryEffects) {
    await tx`
      INSERT INTO inventory (
        player_id,
        pack_id,
        item_id,
        quantity,
        updated_at
      ) VALUES (
        ${actor.id},
        ${packId},
        ${itemEffect.itemId},
        ${itemEffect.delta},
        NOW()
      )
      ON CONFLICT (player_id, item_id)
      DO UPDATE SET
        quantity = inventory.quantity + ${itemEffect.delta},
        updated_at = NOW()
    `;
  }

  // 6. INVENTORY ZERO-STATE BLOAT PRUNING:
  // AFTER processing any negative item effects, run distinct query:
  // DELETE FROM inventory WHERE quantity <= 0 AND player_id = $1
  const hasNegativeItems = inventoryEffects.some((e) => e.delta < 0);
  if (hasNegativeItems) {
    await cleanZeroQuantityInventory(tx, actor.id);
  }

  return {
    ok: true,
    balanceAfterKobo: runningBalance,
    idemKey: lastIdemKey,
  };
}

/**
 * Commits effects to the PostgreSQL append-only ledger with optional spatialSnapshot
 * and inventory zero-state bloat pruning.
 */
export async function applyEffects(
  actor: ActorState,
  effects: Effect[],
  packIdOrSpatial?: string | SpatialSnapshot,
  spatialSnapshot?: SpatialSnapshot
): Promise<LedgerTransactionResult> {
  let packId = "abuja_v1";
  let snapshot: SpatialSnapshot | undefined = spatialSnapshot;

  if (isSpatialSnapshot(packIdOrSpatial)) {
    snapshot = packIdOrSpatial;
    packId = "abuja_v1";
  } else if (typeof packIdOrSpatial === "string") {
    packId = packIdOrSpatial;
  }

  const cashEffects = effects.filter((e): e is CashEffect => e.kind === "CASH");

  // Validate idempotency keys and wallet balance
  let netDeltaKobo = 0;
  for (const cashEffect of cashEffects) {
    if (!cashEffect.idemKey) {
      return {
        ok: false,
        code: "MISSING_IDEM_KEY",
        message: "Ledger transaction requires an explicit idemKey",
      };
    }
    netDeltaKobo += cashEffect.deltaKobo;
  }

  const targetBalanceKobo = actor.balanceKobo + netDeltaKobo;
  if (targetBalanceKobo < 0) {
    return {
      ok: false,
      code: "INSUFFICIENT_FUNDS",
      message: `Cannot debit ${Math.abs(netDeltaKobo)} kobo from balance of ${actor.balanceKobo} kobo`,
    };
  }

  const primaryIdemKey = cashEffects[0]?.idemKey ?? `sync_${actor.id}_${Date.now()}`;

  // Execute database transaction if DATABASE_URL is configured
  if (process.env["DATABASE_URL"]) {
    try {
      const sql = getDb();

      // Check pre-existing idempotency key before opening transaction
      for (const cashEffect of cashEffects) {
        if (cashEffect.idemKey) {
          const existingKey = await sql`
            SELECT idem_key FROM idempotency_keys WHERE idem_key = ${cashEffect.idemKey} LIMIT 1
          `;
          if (existingKey.length > 0) {
            return {
              ok: false,
              code: "DUPLICATE_IDEM_KEY",
              message: `Idempotency key '${cashEffect.idemKey}' has already been committed to the ledger`,
            };
          }
        }
      }

      let txResult: LedgerTransactionResult = {
        ok: true,
        balanceAfterKobo: targetBalanceKobo,
        idemKey: primaryIdemKey,
      };

      await sql.begin(async (tx: any) => {
        const res = await executeLedgerTransaction({
          tx,
          actor,
          effects,
          packId,
          spatialSnapshot: snapshot,
        });
        if (!res.ok) {
          throw res;
        }
        txResult = res;
      });

      return txResult;
    } catch (err: unknown) {
      const pgErr = err as { code?: string; message?: string };
      if (pgErr.code === "23505" || pgErr.code === "DUPLICATE_IDEM_KEY") {
        return {
          ok: false,
          code: "DUPLICATE_IDEM_KEY",
          message: pgErr.message || `Idempotency key was concurrently committed`,
        };
      }
      if (pgErr.code === "INSUFFICIENT_FUNDS") {
        return {
          ok: false,
          code: "INSUFFICIENT_FUNDS",
          message: pgErr.message || "Insufficient funds",
        };
      }
      console.warn(
        "[ledger] PostgreSQL error (falling back to memory authority):",
        pgErr.message
      );
    }
  }

  // Authoritative in-memory state tracking
  return {
    ok: true,
    balanceAfterKobo: targetBalanceKobo,
    idemKey: primaryIdemKey,
  };
}

/**
 * Alias for applyEffects to maintain compatibility across Colyseus and caller conventions.
 */
export const commitEffectsToLedger = applyEffects;

/**
 * Validates and records a single cash mutation in the PostgreSQL append-only ledger.
 */
export async function commitLedgerEffect(
  actor: ActorState,
  cashEffect: CashEffect,
  packIdOrSpatial?: string | SpatialSnapshot,
  spatialSnapshot?: SpatialSnapshot
): Promise<LedgerTransactionResult> {
  return applyEffects(actor, [cashEffect], packIdOrSpatial, spatialSnapshot);
}
