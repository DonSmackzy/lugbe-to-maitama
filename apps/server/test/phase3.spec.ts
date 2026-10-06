// =============================================================================
// Phase 3 Specifications Test Suite
// Verifies:
// 1. PlayerSerial Concurrency Serialization Queue
// 2. Append-Only Ledger Commit & Invariant Protection
// 3. Redis Rate Limiting & Snapshotting
// 4. Aso Villa, The President NPC, and Statutory Disclaimer Verifications
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { PlayerSerialQueue } from "../src/concurrency/PlayerSerial.js";
import { commitLedgerEffect } from "../src/economy/ledger.js";
import { checkRateLimit, type RoomSnapshot } from "../src/storage/redis.js";
import type { ActorState, CashEffect } from "@ltm/engine";
import fs from "fs";
import path from "path";

describe("Phase 3: Server Concurrency, Ledger & Infrastructure", () => {
  // =========================================================================
  // 1. Concurrency Control: PlayerSerialQueue
  // =========================================================================
  describe("Concurrency Control (PlayerSerialQueue)", () => {
    let queue: PlayerSerialQueue;

    beforeEach(() => {
      queue = new PlayerSerialQueue();
    });

    it("should guarantee strict FIFO sequential execution for the same player", async () => {
      const playerId = "citizen_concurrency_1";
      const executionLog: number[] = [];

      // Enqueue 5 asynchronous tasks with randomized micro-delays
      const tasks = [1, 2, 3, 4, 5].map((taskNum) =>
        queue.enqueue(playerId, async () => {
          // Micro delay
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 + 5));
          executionLog.push(taskNum);
          return taskNum;
        })
      );

      const results = await Promise.all(tasks);

      // Verify that every task ran in exact FIFO order regardless of internal latency
      expect(results).toEqual([1, 2, 3, 4, 5]);
      expect(executionLog).toEqual([1, 2, 3, 4, 5]);
      expect(queue.isBusy(playerId)).toBe(false);
    });

    it("should allow distinct players to execute in parallel without cross-blocking", async () => {
      const playerA = "citizen_a";
      const playerB = "citizen_b";
      const timeline: string[] = [];

      const p1 = queue.enqueue(playerA, async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        timeline.push("A_done");
      });

      const p2 = queue.enqueue(playerB, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        timeline.push("B_done");
      });

      await Promise.all([p1, p2]);

      // Player B (shorter delay) finishes before Player A because they have independent queues
      expect(timeline[0]).toBe("B_done");
      expect(timeline[1]).toBe("A_done");
    });
  });

  // =========================================================================
  // 2. Ledger Commit & Invariant Protection
  // =========================================================================
  describe("Postgres Ledger Integration & Wallet Invariants", () => {
    const mockActor: ActorState = {
      id: "player_wallet_test",
      playerId: "player_wallet_test",
      accountId: "acc_test_123",
      position: { x: 0, y: 0 },
      balanceKobo: 50000, // N500
      socialCapital: 10,
      energy: 100,
      home: { districtId: "lugbe" },
      inventory: new Map(),
      pendingFiles: new Map(),
      processedIdemKeys: new Set(),
    };

    it("should require an idemKey on cash ledger effects", async () => {
      const effectWithoutKey: CashEffect = {
        kind: "CASH",
        deltaKobo: -10000,
        idemKey: "",
        ledgerKind: "PURCHASE",
      };

      const result = await commitLedgerEffect(mockActor, effectWithoutKey);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("MISSING_IDEM_KEY");
      }
    });

    it("should reject debits that would drive balance below zero", async () => {
      const overdrawnEffect: CashEffect = {
        kind: "CASH",
        deltaKobo: -100000, // Tries to spend N1,000 with N500 balance
        idemKey: "overdraw_attempt_1",
        ledgerKind: "PURCHASE",
      };

      const result = await commitLedgerEffect(mockActor, overdrawnEffect);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INSUFFICIENT_FUNDS");
      }
    });

    it("should commit valid debit and return updated balance snapshot", async () => {
      const validDebit: CashEffect = {
        kind: "CASH",
        deltaKobo: -20000, // Spends N200
        idemKey: "valid_debit_1",
        ledgerKind: "PURCHASE",
      };

      const result = await commitLedgerEffect(mockActor, validDebit);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.balanceAfterKobo).toBe(30000);
        expect(result.idemKey).toBe("valid_debit_1");
      }
    });
  });

  // =========================================================================
  // 3. Redis Rate Limiting & Storage
  // =========================================================================
  describe("Rate Limiting Engine", () => {
    it("should enforce intent frequency ceiling and block excess requests", async () => {
      const accountId = "spammer_account";
      const action = "BUY";
      const limit = 5;

      const results = [];
      for (let i = 0; i < 7; i++) {
        results.push(await checkRateLimit(accountId, action, limit, 1));
      }

      // First 5 allowed
      for (let i = 0; i < 5; i++) {
        expect(results[i]?.allowed).toBe(true);
      }

      // 6th and 7th blocked
      expect(results[5]?.allowed).toBe(false);
      expect(results[6]?.allowed).toBe(false);
    });
  });

  // =========================================================================
  // 4. The Villa, The President NPC, and Statutory Disclaimer Verifications
  // =========================================================================
  describe("The Villa, The President & Legal Compliance", () => {
    function findRoot(): string {
      let dir = process.cwd();
      for (let i = 0; i < 4; i++) {
        if (fs.existsSync(path.join(dir, "city-packs/abuja/districts.json"))) {
          return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return process.cwd();
    }

    it("should have 'the_villa' registered in districts.json with 'apex' tier and entry requirements", () => {
      const districtsPath = path.resolve(findRoot(), "city-packs/abuja/districts.json");
      expect(fs.existsSync(districtsPath)).toBe(true);

      const districtsData = JSON.parse(fs.readFileSync(districtsPath, "utf-8"));
      const villa = districtsData.districts.find((d: any) => d.id === "the_villa");

      expect(villa).toBeDefined();
      expect(villa.tier).toBe("apex");
      expect(villa.entryRequirements).toBeDefined();
      expect(villa.entryRequirements.minSocialCapital).toBe(50000);
      expect(villa.entryRequirements.requiredItem).toBe("vip_clearance");
    });

    it("should have 'the_president' NPC registered in npcs.json in 'the_villa' with 'head_of_state' archetype", () => {
      const npcsPath = path.resolve(findRoot(), "city-packs/abuja/npcs.json");
      expect(fs.existsSync(npcsPath)).toBe(true);

      const npcsData = JSON.parse(fs.readFileSync(npcsPath, "utf-8"));
      const president = npcsData.npcs.find((n: any) => n.id === "the_president");

      expect(president).toBeDefined();
      expect(president.location).toBe("the_villa");
      expect(president.archetype).toBe("head_of_state");
    });

    it("should verify the statutory satire disclaimer text in apps/web matches verbatim", () => {
      const splashPath = path.resolve(findRoot(), "apps/web/src/ui/SplashScreen.ts");
      expect(fs.existsSync(splashPath)).toBe(true);

      const content = fs.readFileSync(splashPath, "utf-8");
      const requiredDisclaimer =
        "DISCLAIMER: Lugbe to Maitama is a work of fiction and satire. All names, characters, businesses, places, events, and incidents are either the products of the creator's imagination or used in a fictitious manner. Any resemblance to actual persons (living or dead), including the 'President' or any government officials, is purely coincidental.";

      expect(content).toContain(requiredDisclaimer);
    });

    it("should reject Colyseus room connections if the satire disclaimer was bypassed or not accepted", async () => {
      const { WorldRoom } = await import("../src/rooms/WorldRoom.js");
      const room = new WorldRoom();
      const mockClient = { sessionId: "sess_bypass_attacker" } as any;

      // 1. Missing disclaimer payload (console bypass attempt)
      await expect(room.onAuth(mockClient, {} as any)).rejects.toThrow(
        /REJECTED: Statutory satire disclaimer/
      );

      // 2. Explicit false disclaimer payload
      await expect(
        room.onAuth(mockClient, { disclaimerAccepted: false } as any)
      ).rejects.toThrow(/REJECTED: Statutory satire disclaimer/);

      // 3. Valid acknowledged disclaimer payload
      const authResult = await room.onAuth(mockClient, {
        disclaimerAccepted: true,
        disclaimerAcceptedAt: Date.now(),
      } as any);
      expect(authResult).toBe(true);
    });
  });
});
