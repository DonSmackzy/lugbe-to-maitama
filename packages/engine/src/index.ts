// =============================================================================
// @ltm/engine — Pure TypeScript simulation engine
// CONSTRAINT: This package MUST NOT import from apps/*, window, fs, or any I/O.
// It receives a validated CityPack and operates on plain data structures only.
// =============================================================================

// Core Phase 2 Functions
export { resolve, applyEffects } from "./resolve.js";
export { advance } from "./advance.js";
export { npcContext, getWealthTier, getReputationTier } from "./npc-context.js";

// NavGrid & Spatial Zoning
export { NavGrid } from "./nav-grid.js";
export type { District, DistrictTier, NavValidationResult } from "./nav-grid.js";

// Rules Engine
export * from "./rules/index.js";

// Effects
export * from "./effects.js";

// State Types
export type {
  ActorState,
  ActorHome,
  PlayerState,
  NpcInstance,
  WorldState,
  EngineState,
} from "./state.js";

// Sub-engines (Backward Compatibility)
export { SimulationEngine } from "./simulation.js";
export { LedgerProcessor } from "./ledger.js";
export { MarketEngine } from "./market.js";
export { MovementEngine } from "./movement.js";

// Transit System (Along & Bolt)
export {
  resolveTransit,
  calculateTransitFare,
  isTransitAvailable,
  BASE_TRANSIT_FARE_KOBO,
  ALONG_FARE_MULTIPLIER,
  BOLT_FARE_MULTIPLIER,
  ALONG_ENERGY_DELTA,
  BOLT_ENERGY_DELTA,
  BOLT_HIGHBROW_SC_BONUS,
  HIGHBROW_DISTRICT_IDS,
  SATELLITE_DISTRICT_IDS,
  APEX_RESTRICTED_DISTRICT_IDS,
} from "./transit.js";
export type { TransitAvailabilityResult } from "./transit.js";
