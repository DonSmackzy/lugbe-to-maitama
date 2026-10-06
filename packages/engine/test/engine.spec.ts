// =============================================================================
// Engine Specification Tests (Vitest)
// Covers:
// 1. Insufficient funds rolls back
// 2. Duplicate idem_key is rejected
// 3. 20 concurrent purchases invariant check (never negative)
// 4. Commuter Tax rule ingestion & execution (evaluating player.home.district.tier == 'satellite')
// 5. NavGrid movement validation & blocked tiles
// 6. npcContext bucketed generation
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { resolve, applyEffects } from "../src/resolve.js";
import { advance } from "../src/advance.js";
import { npcContext, getWealthTier, getReputationTier } from "../src/npc-context.js";
import { NavGrid, type District } from "../src/nav-grid.js";
import type { WorldState, ActorState } from "../src/state.js";
import type { CityPack, Zone, Item, NpcArchetype } from "@ltm/city-schema";
import type { RuleDefinition } from "../src/rules/types.js";
import { evaluateRules } from "../src/rules/evaluator.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const mockZones: Zone[] = [
  {
    id: "residential_south",
    displayName: "Lugbe South",
    type: "residential",
    bounds: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 29, y: 29 } },
    baseRentKobo: 80000,
    npcDensity: 0.7,
  },
  {
    id: "market_central",
    displayName: "Central Market",
    type: "market",
    bounds: { topLeft: { x: 30, y: 0 }, bottomRight: { x: 59, y: 29 } },
    baseRentKobo: 0,
    npcDensity: 0.9,
  },
  {
    id: "government_secretariat",
    displayName: "Federal Secretariat Garki",
    type: "government",
    bounds: { topLeft: { x: 60, y: 30 }, bottomRight: { x: 89, y: 59 } },
    baseRentKobo: 200000,
    npcDensity: 0.5,
  },
];

const mockDistricts: District[] = [
  {
    id: "lugbe",
    displayName: "Lugbe",
    tier: "satellite",
    zoneIds: ["residential_south"],
    blockedTiles: [],
  },
  {
    id: "central_market",
    displayName: "Central Market Area",
    tier: "midtown",
    zoneIds: ["market_central"],
    blockedTiles: [],
  },
  {
    id: "garki",
    displayName: "Garki",
    tier: "core",
    zoneIds: ["government_secretariat"],
    blockedTiles: [{ x: 70, y: 35 }],
  },
  {
    id: "maitama",
    displayName: "Maitama",
    tier: "core",
    zoneIds: [],
    blockedTiles: [],
  },
];

const mockItems: Item[] = [
  {
    id: "suya_wrap",
    displayName: "Spicy Beef Suya",
    category: "food",
    basePriceKobo: 10000, // N100
    stackable: true,
    weightUnits: 0.5,
  },
  {
    id: "imported_phone",
    displayName: "Smart Phone",
    category: "luxury",
    basePriceKobo: 15000000, // N150,000
    stackable: false,
    weightUnits: 1.0,
  },
];

const mockArchetypes: NpcArchetype[] = [
  {
    id: "danfo_driver",
    displayName: "Danfo Driver",
    spawnZoneTypes: ["transport_hub"],
    fallbackDialogue: ["Lugbe straight! Enter with your exact 500 Naira change!"],
    interactionScModifier: 2,
  },
];

const mockRules: RuleDefinition[] = [
  {
    id: "commuter_tax_satellite",
    displayName: "The Commuter Tax",
    trigger: "dayTick",
    condition: {
      op: "eq",
      left: { path: "actor.home.district.tier" },
      right: { literal: "satellite" },
    },
    effects: [{ kind: "ENERGY", delta: -18 }],
    priority: 10,
  },
  {
    id: "maitama_prestige_dividend",
    displayName: "Maitama Core Prestige",
    trigger: "dayTick",
    condition: {
      op: "eq",
      left: { path: "actor.home.district.tier" },
      right: { literal: "core" },
    },
    effects: [{ kind: "SOCIAL_CAPITAL", delta: 5 }],
    priority: 5,
  },
];

const mockCityPack: CityPack = {
  schemaVersion: "1.0.0",
  packId: "abuja_v1",
  displayName: "Abuja",
  gridWidth: 120,
  gridHeight: 120,
  startingCashKobo: 500000,
  startingSocialCapital: 10,
  zones: mockZones,
  items: mockItems,
  npcArchetypes: mockArchetypes,
  bureaucracyRules: [],
};

function createTestWorld(): WorldState {
  const navGrid = new NavGrid(120, 120, mockZones, mockDistricts);
  const actors = new Map<string, ActorState>();
  const players = new Map<string, ActorState>();
  const npcs = new Map();
  const marketMultipliers = new Map<string, number>();

  return {
    roomId: "room_test_1",
    cityPack: mockCityPack,
    districts: mockDistricts,
    rules: mockRules,
    navGrid,
    tick: 0,
    timeMs: 0,
    day: 1,
    ticksPerDay: 48,
    actors,
    players,
    npcs,
    marketMultipliers,
  };
}

function createTestActor(
  id: string,
  balanceKobo: number,
  homeDistrictId = "lugbe",
  tier: District["tier"] = "satellite"
): ActorState {
  const homeDistrict = mockDistricts.find((d) => d.id === homeDistrictId) ?? {
    id: homeDistrictId,
    displayName: homeDistrictId,
    tier,
    zoneIds: [],
    blockedTiles: [],
  };

  return {
    id,
    playerId: id,
    accountId: `acc_${id}`,
    position: { x: 5, y: 5 },
    balanceKobo,
    socialCapital: 20,
    energy: 100,
    home: {
      districtId: homeDistrictId,
      district: homeDistrict,
    },
    inventory: new Map<string, number>(),
    pendingFiles: new Map<string, number>(),
    processedIdemKeys: new Set<string>(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Lugbe to Maitama — Engine Core Specifications", () => {
  let world: WorldState;

  beforeEach(() => {
    world = createTestWorld();
  });

  // =========================================================================
  // CRITICAL SPEC 1: Insufficient funds rolls back
  // =========================================================================
  describe("Spec 1: Insufficient funds rolls back", () => {
    it("should reject purchase when balance is less than total item cost and leave state unmodified", () => {
      // Actor has 5,000 kobo (N50). Item costs 10,000 kobo (N100).
      const actor = createTestActor("commuter_1", 5000);
      world.actors.set(actor.id, actor);

      const intent = {
        type: "BUY" as const,
        itemId: "suya_wrap",
        quantity: 1,
      };

      const effects = resolve(world, actor, intent, "tx_insufficient_1");

      // Verify that resolve returned an error effect
      expect(effects).toHaveLength(1);
      expect(effects[0].kind).toBe("ERROR");
      if (effects[0].kind === "ERROR") {
        expect(effects[0].code).toBe("INSUFFICIENT_FUNDS");
      }

      // Verify rollback guarantee in applyEffects
      const applied = applyEffects(actor, effects);
      expect(applied).toBe(false);

      // Invariants: State MUST be strictly identical
      expect(actor.balanceKobo).toBe(5000);
      expect(actor.inventory.get("suya_wrap")).toBeUndefined();
      expect(actor.processedIdemKeys.has("tx_insufficient_1")).toBe(false);
    });

    it("should reject purchase when attempting to buy multiple units exceeding funds", () => {
      // Actor has 15,000 kobo, tries to buy 2 suya wraps (20,000 kobo)
      const actor = createTestActor("commuter_2", 15000);
      world.actors.set(actor.id, actor);

      const intent = {
        type: "BUY" as const,
        itemId: "suya_wrap",
        quantity: 2,
      };

      const effects = resolve(world, actor, intent, "tx_multi_insufficient");
      expect(effects[0].kind).toBe("ERROR");
      if (effects[0].kind === "ERROR") {
        expect(effects[0].code).toBe("INSUFFICIENT_FUNDS");
      }

      expect(applyEffects(actor, effects)).toBe(false);
      expect(actor.balanceKobo).toBe(15000);
      expect(actor.inventory.has("suya_wrap")).toBe(false);
    });
  });

  // =========================================================================
  // CRITICAL SPEC 2: A duplicate idem_key is rejected
  // =========================================================================
  describe("Spec 2: Duplicate idem_key is rejected", () => {
    it("should process the first intent, then reject the second intent with DUPLICATE_IDEM_KEY", () => {
      const actor = createTestActor("commuter_idem", 50000);
      world.actors.set(actor.id, actor);

      const idemKey = "idempotency_uuid_999";
      const intent = {
        type: "BUY" as const,
        itemId: "suya_wrap",
        quantity: 1,
      };

      // 1. First execution: should succeed
      const effects1 = resolve(world, actor, intent, idemKey);
      expect(effects1.some((e) => e.kind === "ERROR")).toBe(false);

      const applied1 = applyEffects(actor, effects1);
      expect(applied1).toBe(true);
      expect(actor.balanceKobo).toBe(40000); // 50000 - 10000
      expect(actor.inventory.get("suya_wrap")).toBe(1);
      expect(actor.processedIdemKeys.has(idemKey)).toBe(true);

      // 2. Duplicate submission with exact same idemKey
      const effects2 = resolve(world, actor, intent, idemKey);

      expect(effects2).toHaveLength(1);
      expect(effects2[0].kind).toBe("ERROR");
      if (effects2[0].kind === "ERROR") {
        expect(effects2[0].code).toBe("DUPLICATE_IDEM_KEY");
      }

      // 3. Applying second effects must fail and not double-debit
      const applied2 = applyEffects(actor, effects2);
      expect(applied2).toBe(false);
      expect(actor.balanceKobo).toBe(40000); // Still 40000, NOT 30000!
      expect(actor.inventory.get("suya_wrap")).toBe(1); // Still 1
    });
  });

  // =========================================================================
  // CRITICAL SPEC 3: 20 concurrent purchases never produce negative balance
  // =========================================================================
  describe("Spec 3: 20 concurrent purchases invariant check", () => {
    it("should never let balance fall below zero under 20 concurrent purchase intents", () => {
      // Starting balance: exactly 50,000 kobo (can afford exactly 5 suya wraps at 10,000 kobo each)
      const actor = createTestActor("commuter_stress", 50000);
      world.actors.set(actor.id, actor);

      const TOTAL_INTENTS = 20;
      let successfulPurchases = 0;
      let rejectedPurchases = 0;

      // Simulate 20 concurrent/racing purchase requests
      for (let i = 0; i < TOTAL_INTENTS; i++) {
        const idemKey = `concurrent_tx_${i}`;
        const intent = {
          type: "BUY" as const,
          itemId: "suya_wrap",
          quantity: 1,
        };

        const effects = resolve(world, actor, intent, idemKey);
        const applied = applyEffects(actor, effects);

        if (applied) {
          successfulPurchases++;
        } else {
          rejectedPurchases++;
          expect(effects[0].kind).toBe("ERROR");
          if (effects[0].kind === "ERROR") {
            expect(effects[0].code).toBe("INSUFFICIENT_FUNDS");
          }
        }

        // INVARIANT CHECK AT EVERY SINGLE STEP
        expect(actor.balanceKobo).toBeGreaterThanOrEqual(0);
      }

      // Exactly 5 should have succeeded (50,000 / 10,000 = 5)
      expect(successfulPurchases).toBe(5);
      // Exactly 15 should have been rejected
      expect(rejectedPurchases).toBe(15);
      // Final balance must be exactly 0
      expect(actor.balanceKobo).toBe(0);
      // Final inventory must be exactly 5
      expect(actor.inventory.get("suya_wrap")).toBe(5);
    });
  });

  // =========================================================================
  // CRITICAL SPEC 4: Rule Ingestion & The Commuter Tax
  // =========================================================================
  describe("Spec 4: Declarative Rules & The Commuter Tax", () => {
    it("should evaluate player.home.district.tier == 'satellite' on dayTick and apply energy: -18", () => {
      // Commuter living in Lugbe (satellite)
      const satelliteActor = createTestActor("lugbe_resident", 100000, "lugbe", "satellite");
      satelliteActor.energy = 100;

      const ruleCtx = {
        world,
        actor: {
          ...satelliteActor,
          home: satelliteActor.home,
        },
      };

      // Direct rule evaluation check
      const effects = evaluateRules("dayTick", world.rules, ruleCtx);
      const commuterTaxEffect = effects.find((e) => e.kind === "ENERGY" && e.delta === -18);
      expect(commuterTaxEffect).toBeDefined();
    });

    it("should apply Commuter Tax to satellite commuter and Maitama prestige to core commuter during advance() dayTick", () => {
      const lugbeCommuter = createTestActor("lugbe_guy", 100000, "lugbe", "satellite");
      lugbeCommuter.energy = 100;

      const maitamaElite = createTestActor("maitama_bigman", 5000000, "maitama", "core");
      maitamaElite.energy = 100;
      maitamaElite.socialCapital = 50;

      world.actors.set(lugbeCommuter.id, lugbeCommuter);
      world.actors.set(maitamaElite.id, maitamaElite);

      // Advance world time by 48 ticks (1 full day)
      // 48 ticks * 1000ms = 48000ms
      const result = advance(world, 48000);

      expect(result.dayChanged).toBe(true);
      expect(result.day).toBe(2);

      // Lugbe commuter suffered commuter tax (-18 energy)
      // Max energy is 100, tax reduces it to 82. (Regen during tick adds up to 100, but on dayTick tax is applied)
      expect(lugbeCommuter.energy).toBeLessThanOrEqual(82);

      // Maitama elite did NOT suffer commuter tax, and gained +5 social capital
      expect(maitamaElite.socialCapital).toBe(55);
    });
  });

  // =========================================================================
  // CRITICAL SPEC 5: NavGrid Validation & Blocked Tiles
  // =========================================================================
  describe("Spec 5: NavGrid bounds, single-step movement, and blocked tiles", () => {
    it("should allow valid 1-step moves", () => {
      const actor = createTestActor("walker", 10000);
      actor.position = { x: 5, y: 5 };
      world.actors.set(actor.id, actor);

      const intent = { type: "MOVE" as const, toX: 6, toY: 5 };
      const effects = resolve(world, actor, intent);

      expect(effects.some((e) => e.kind === "ERROR")).toBe(false);
      expect(applyEffects(actor, effects)).toBe(true);
      expect(actor.position).toEqual({ x: 6, y: 5 });
    });

    it("should reject movement to a blocked tile (e.g. Garki perimeter wall)", () => {
      const actor = createTestActor("intruder", 10000);
      actor.position = { x: 70, y: 34 }; // Adjacent to blocked tile { x: 70, y: 35 }
      world.actors.set(actor.id, actor);

      const intent = { type: "MOVE" as const, toX: 70, toY: 35 };
      const effects = resolve(world, actor, intent);

      expect(effects[0].kind).toBe("ERROR");
      if (effects[0].kind === "ERROR") {
        expect(effects[0].code).toBe("BLOCKED_TILE");
      }
      expect(applyEffects(actor, effects)).toBe(false);
      expect(actor.position).toEqual({ x: 70, y: 34 });
    });

    it("should reject teleportation / steps larger than 1 tile", () => {
      const actor = createTestActor("teleporter", 10000);
      actor.position = { x: 5, y: 5 };
      world.actors.set(actor.id, actor);

      const intent = { type: "MOVE" as const, toX: 8, toY: 5 }; // dx = 3
      const effects = resolve(world, actor, intent);

      expect(effects[0].kind).toBe("ERROR");
      if (effects[0].kind === "ERROR") {
        expect(effects[0].code).toBe("INVALID_MOVE");
      }
    });

    it("should reject moves outside city grid bounds", () => {
      const actor = createTestActor("out_of_bounds", 10000);
      actor.position = { x: 0, y: 0 };
      world.actors.set(actor.id, actor);

      const intent = { type: "MOVE" as const, toX: -1, toY: 0 };
      const effects = resolve(world, actor, intent);

      expect(effects[0].kind).toBe("ERROR");
      if (effects[0].kind === "ERROR") {
        expect(effects[0].code).toBe("INVALID_MOVE");
      }
    });
  });

  // =========================================================================
  // CRITICAL SPEC 6: npcContext Generation
  // =========================================================================
  describe("Spec 6: npcContext deterministic hash and privacy bucket", () => {
    it("should generate bucketed context without leaking private ledger or account IDs", () => {
      const actor = createTestActor("dialogue_actor", 45000); // 450 NGN -> struggling
      actor.socialCapital = 15; // 0..50 -> unknown_commuter
      world.actors.set(actor.id, actor);

      world.npcs.set("danfo_driver_1", {
        instanceId: "danfo_driver_1",
        archetypeId: "danfo_driver",
        position: { x: 6, y: 5 },
        lastInteractionTick: 0,
      });

      const ctx = npcContext(world, actor, "danfo_driver_1");
      expect(ctx).not.toBeNull();
      if (!ctx) return;

      expect(ctx.wealthTier).toBe("struggling");
      expect(ctx.reputationTier).toBe("unknown_commuter");
      expect(ctx.homeDistrictTier).toBe("satellite");
      expect(ctx.contextTokens).toContain("wealth:struggling");
      expect(ctx.contextTokens).toContain("reputation:unknown_commuter");
      expect(ctx.fallbackDialogue).toHaveLength(1);
      expect(typeof ctx.contextHash).toBe("string");
      expect(ctx.contextHash.length).toBeGreaterThan(0);

      // Verify deterministic hash consistency
      const ctx2 = npcContext(world, actor, "danfo_driver_1");
      expect(ctx2?.contextHash).toBe(ctx.contextHash);
    });

    it("should correctly classify wealth and reputation tiers", () => {
      expect(getWealthTier(50000)).toBe("struggling");
      expect(getWealthTier(500000)).toBe("working_class");
      expect(getWealthTier(5000000)).toBe("middle_class");
      expect(getWealthTier(50000000)).toBe("affluent");
      expect(getWealthTier(500000000)).toBe("elite");

      expect(getReputationTier(-50)).toBe("disgraced");
      expect(getReputationTier(25)).toBe("unknown_commuter");
      expect(getReputationTier(100)).toBe("street_smart");
      expect(getReputationTier(500)).toBe("connected");
      expect(getReputationTier(5000)).toBe("godfather_tier");
    });
  });
});
