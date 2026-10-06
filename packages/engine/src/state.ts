// =============================================================================
// Engine State Types — Pure data structures. Zero classes, zero side effects.
// =============================================================================

import type { CityPack, Coord, Zone } from "@ltm/city-schema";
import type { District } from "./nav-grid.js";
import type { RuleDefinition } from "./rules/types.js";
import { NavGrid } from "./nav-grid.js";

export type ActorHome = {
  districtId: string;
  district?: District;
};

export type ActorState = {
  id: string;
  playerId: string;
  accountId: string;
  position: Coord;
  /** Authoritative kobo balance. Always integer, never negative. */
  balanceKobo: number;
  /** Social capital score (-999,999 to 1,000,000) */
  socialCapital: number;
  /** Energy points [0, 100] */
  energy: number;
  /** Home district reference for rules like commuter tax */
  home: ActorHome;
  /** item_id -> quantity */
  inventory: Map<string, number>;
  /** bureaucracy_rule_id -> tick when it resolves */
  pendingFiles: Map<string, number>;
  /** Set of processed idempotency keys */
  processedIdemKeys: Set<string>;
};

export type PlayerState = ActorState;

export type NpcInstance = {
  instanceId: string;
  archetypeId: string;
  position: Coord;
  lastInteractionTick: number;
};

export type WorldState = {
  roomId: string;
  cityPack: CityPack;
  districts: District[];
  rules: RuleDefinition[];
  navGrid: NavGrid;
  tick: number;
  timeMs: number;
  day: number;
  ticksPerDay: number;
  actors: Map<string, ActorState>;
  players: Map<string, PlayerState>;
  npcs: Map<string, NpcInstance>;
  /** zone_id or item_id -> multiplier */
  marketMultipliers: Map<string, number>;
};

export type EngineState = WorldState;
