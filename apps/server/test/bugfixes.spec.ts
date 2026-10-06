// =============================================================================
// Backend Vulnerability Patch Specifications — apps/server/test/bugfixes.spec.ts
// Verifies:
// 1. The "Double-Charge Commute" Bug Fix: Atomic spatialSnapshot + ledger sync in same tx
// 2. Postgres Deadlock Prevention: Alphabetical player ID sorting and sequential FOR UPDATE locks
// 3. Inventory Zero-State Bloat: Distinct subsequent DELETE query for quantity <= 0 items
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  sortPlayerIds,
  lockPlayers,
  cleanZeroQuantityInventory,
  executeLedgerTransaction,
  applyEffects,
  commitEffectsToLedger,
  type SpatialSnapshot,
} from "../src/economy/ledger.js";
import type { ActorState, CashEffect, InventoryEffect } from "@ltm/engine";

interface RecordedQuery {
  raw: string;
  values: any[];
}

function createMockTx() {
  const queries: RecordedQuery[] = [];
  const fn: any = async (strings: TemplateStringsArray, ...values: any[]) => {
    const raw = strings.reduce(
      (acc, str, i) => acc + str + (values[i] !== undefined ? `$${i + 1}` : ""),
      ""
    );
    queries.push({ raw, values });
    return [];
  };
  fn.json = (val: any) => JSON.stringify(val);
  return { tx: fn, queries };
}

describe("Architectural Audit Vulnerability Fixes", () => {
  const baseActor: ActorState = {
    id: "uuid_citizen_001",
    playerId: "uuid_citizen_001",
    accountId: "uuid_acc_001",
    position: { x: 5, y: 10 },
    balanceKobo: 50000, // N500.00
    socialCapital: 100,
    energy: 80,
    home: { districtId: "lugbe" },
    inventory: new Map([["danfo_ticket", 1]]),
    pendingFiles: new Map(),
    processedIdemKeys: new Set(),
  };

  // ===========================================================================
  // 1. Deadlock Prevention (P2P Architecture Prep)
  // ===========================================================================
  describe("Bug 2: Postgres Deadlock Prevention", () => {
    it("should strictly sort player IDs alphabetically and eliminate duplicate entries", () => {
      const unsortedIds = [
        "player_zulu",
        "player_bravo",
        "player_alpha",
        "player_bravo",
        "player_yankee",
      ];

      const sorted = sortPlayerIds(unsortedIds);

      expect(sorted).toEqual([
        "player_alpha",
        "player_bravo",
        "player_yankee",
        "player_zulu",
      ]);
    });

    it("should acquire row locks in strict alphabetical order using SELECT ... FOR UPDATE", async () => {
      const { tx, queries } = createMockTx();
      const playerIds = ["uuid_charlie", "uuid_alice", "uuid_bob", "uuid_alice"];

      const lockedOrder = await lockPlayers(tx, playerIds);

      // Verify returned ordering
      expect(lockedOrder).toEqual(["uuid_alice", "uuid_bob", "uuid_charlie"]);

      // Verify SQL execution order
      expect(queries).toHaveLength(3);
      expect(queries[0]?.raw).toContain("SELECT id FROM players WHERE id = $1 FOR UPDATE");
      expect(queries[0]?.values[0]).toBe("uuid_alice");

      expect(queries[1]?.raw).toContain("SELECT id FROM players WHERE id = $1 FOR UPDATE");
      expect(queries[1]?.values[0]).toBe("uuid_bob");

      expect(queries[2]?.raw).toContain("SELECT id FROM players WHERE id = $1 FOR UPDATE");
      expect(queries[2]?.values[0]).toBe("uuid_charlie");
    });
  });

  // ===========================================================================
  // 2. The "Double-Charge Commute" Bug (Atomic Spatial + Ledger Sync)
  // ===========================================================================
  describe("Bug 1: The 'Double-Charge Commute' Bug (Atomic Spatial Sync)", () => {
    it("should update pos_x, pos_y, and district_id in the players table within the EXACT SAME transaction as ledger_entries", async () => {
      const { tx, queries } = createMockTx();
      const actor = { ...baseActor };

      const commuteFareEffect: CashEffect = {
        kind: "CASH",
        deltaKobo: -15000, // N150 bus fare
        idemKey: "commute_idem_101",
        ledgerKind: "PURCHASE",
      };

      const spatialSnapshot: SpatialSnapshot = {
        x: 45,
        y: 60,
        districtId: "wuse",
      };

      const result = await executeLedgerTransaction({
        tx,
        actor,
        effects: [commuteFareEffect],
        packId: "abuja_v1",
        spatialSnapshot,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.balanceAfterKobo).toBe(35000);
      }

      // Check all queries executed in this single transaction
      const queryTexts = queries.map((q) => q.raw);

      // 1. Row locking
      expect(queryTexts.some((q) => q.includes("SELECT id FROM players WHERE id = $1 FOR UPDATE"))).toBe(true);

      // 2. Ledger entries insert
      const ledgerInsert = queries.find((q) => q.raw.includes("INSERT INTO ledger_entries"));
      expect(ledgerInsert).toBeDefined();
      expect(ledgerInsert?.values).toContain("uuid_acc_001");
      expect(ledgerInsert?.values).toContain(15000); // debit amount
      expect(ledgerInsert?.values).toContain(35000); // balance after
      expect(ledgerInsert?.values).toContain("commute_idem_101");

      // 3. Atomic spatial + financial players update
      const playerUpdate = queries.find((q) => q.raw.includes("UPDATE players"));
      expect(playerUpdate).toBeDefined();
      expect(playerUpdate?.raw).toContain("pos_x = $2");
      expect(playerUpdate?.raw).toContain("pos_y = $3");
      expect(playerUpdate?.raw).toContain("district_id = $4");
      expect(playerUpdate?.values[0]).toBe(35000); // new balance
      expect(playerUpdate?.values[1]).toBe(45); // pos_x
      expect(playerUpdate?.values[2]).toBe(60); // pos_y
      expect(playerUpdate?.values[3]).toBe("wuse"); // district_id
    });

    it("should accept optional spatialSnapshot via applyEffects and commitEffectsToLedger without modifying pure Effect", async () => {
      const actor = { ...baseActor };
      const spatialSnapshot: SpatialSnapshot = {
        x: 99,
        y: 99,
        districtId: "the_villa",
      };

      const cashEffect: CashEffect = {
        kind: "CASH",
        deltaKobo: 0,
        idemKey: "villa_tour_0",
        ledgerKind: "REWARD",
      };

      // Both function aliases should accept spatialSnapshot seamlessly
      const res1 = await applyEffects(actor, [cashEffect], spatialSnapshot);
      expect(res1.ok).toBe(true);

      const res2 = await commitEffectsToLedger(actor, [cashEffect], "abuja_v1", spatialSnapshot);
      expect(res2.ok).toBe(true);
    });
  });

  // ===========================================================================
  // 3. Inventory Zero-State Bloat (Safe SQL Execution)
  // ===========================================================================
  describe("Bug 3: Inventory Zero-State Bloat", () => {
    it("should execute a distinct subsequent DELETE query for quantity <= 0 items after processing negative item effects", async () => {
      const { tx, queries } = createMockTx();
      const actor = { ...baseActor };

      const consumeItemEffect: InventoryEffect = {
        kind: "INVENTORY",
        itemId: "danfo_ticket",
        delta: -1, // Player uses up the ticket
      };

      await executeLedgerTransaction({
        tx,
        actor,
        effects: [consumeItemEffect],
        packId: "abuja_v1",
      });

      // Find the inventory upsert and the subsequent DELETE query
      const inventoryUpsertIdx = queries.findIndex((q) =>
        q.raw.includes("INSERT INTO inventory")
      );
      const inventoryDeleteIdx = queries.findIndex((q) =>
        q.raw.includes("DELETE FROM inventory WHERE quantity <= 0 AND player_id = $1")
      );

      expect(inventoryUpsertIdx).toBeGreaterThanOrEqual(0);
      expect(inventoryDeleteIdx).toBeGreaterThanOrEqual(0);

      // CRITICAL CONSTRAINT: The DELETE query must run as a subsequent query AFTER the upsert
      expect(inventoryDeleteIdx).toBeGreaterThan(inventoryUpsertIdx);

      // Verify the player ID parameter on the DELETE query
      expect(queries[inventoryDeleteIdx]?.values[0]).toBe("uuid_citizen_001");
    });

    it("should not execute DELETE query when only positive item gains occur", async () => {
      const { tx, queries } = createMockTx();
      const actor = { ...baseActor };

      const gainItemEffect: InventoryEffect = {
        kind: "INVENTORY",
        itemId: "suya",
        delta: 2, // Gained 2 suya
      };

      await executeLedgerTransaction({
        tx,
        actor,
        effects: [gainItemEffect],
        packId: "abuja_v1",
      });

      const hasDelete = queries.some((q) =>
        q.raw.includes("DELETE FROM inventory")
      );
      expect(hasDelete).toBe(false);
    });

    it("should allow cleanZeroQuantityInventory to be invoked directly with player_id", async () => {
      const { tx, queries } = createMockTx();

      await cleanZeroQuantityInventory(tx, "player_test_clean_007");

      expect(queries).toHaveLength(1);
      expect(queries[0]?.raw).toContain(
        "DELETE FROM inventory WHERE quantity <= 0 AND player_id = $1"
      );
      expect(queries[0]?.values[0]).toBe("player_test_clean_007");
    });
  });
});
