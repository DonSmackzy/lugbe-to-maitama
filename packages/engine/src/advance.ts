// =============================================================================
// advance — Pure simulation advance function: (world, dtMs) -> AdvanceResult
// Advances game time, ticks, day cycles, declarative rules (Commuter Tax),
// energy regeneration, and market fluctuations.
// Zero imports from apps/*, DOM, window, or fs.
// =============================================================================

import type { WorldState, ActorState } from "./state.js";
import type { Effect } from "./effects.js";
import { evaluateRules } from "./rules/evaluator.js";
import { applyEffects } from "./resolve.js";

export type AdvanceResult = {
  previousTick: number;
  currentTick: number;
  ticksAdvanced: number;
  day: number;
  dayChanged: boolean;
  /** All effects generated during advance, keyed by actor ID */
  actorEffects: Map<string, Effect[]>;
  /** Global effects */
  globalEffects: Effect[];
};

export const DEFAULT_TICK_MS = 1000;
export const DEFAULT_ENERGY_REGEN_PER_TICK = 0.5;

/**
 * Purely advances the world state by dtMs.
 * Mutates world state directly in authoritative Colyseus process memory.
 */
export function advance(
  world: WorldState,
  dtMs: number,
  tickMs = DEFAULT_TICK_MS
): AdvanceResult {
  const previousTick = world.tick;
  world.timeMs += dtMs;

  const totalTicks = Math.floor(world.timeMs / tickMs);
  const ticksAdvanced = totalTicks - world.tick;

  const actorEffects = new Map<string, Effect[]>();
  const globalEffects: Effect[] = [];
  let dayChanged = false;

  for (let t = 0; t < ticksAdvanced; t++) {
    world.tick++;

    // 1. Check if day boundary crossed
    const isDayTick = world.tick % world.ticksPerDay === 0;
    if (isDayTick) {
      world.day++;
      dayChanged = true;
    }

    // 2. Process each actor
    for (const actor of world.actors.values()) {
      const effectsForActor: Effect[] = [];

      // A. Energy regeneration per tick (capped at 100)
      if (actor.energy < 100) {
        const regenAmount = Math.min(100 - actor.energy, DEFAULT_ENERGY_REGEN_PER_TICK);
        if (regenAmount > 0) {
          const energyEffect: Effect = { kind: "ENERGY", delta: regenAmount };
          effectsForActor.push(energyEffect);
        }
      }

      // B. Day tick rules (e.g. Commuter Tax!)
      if (isDayTick) {
        const ruleCtx = {
          world,
          actor: {
            ...actor,
            home: actor.home,
            currentDistrict: world.navGrid.getDistrictAt(actor.position.x, actor.position.y),
          },
        };

        const ruleEffects = evaluateRules("dayTick", world.rules, ruleCtx, `day_${world.day}_${actor.id}`);
        effectsForActor.push(...ruleEffects);
      }

      // C. Bureaucracy files resolution
      for (const [ruleId, resolvesAtTick] of actor.pendingFiles.entries()) {
        if (world.tick >= resolvesAtTick) {
          actor.pendingFiles.delete(ruleId);
          // Award bureaucracy resolution bonus
          const bonusEffect: Effect = { kind: "SOCIAL_CAPITAL", delta: 15 };
          effectsForActor.push(bonusEffect);
        }
      }

      if (effectsForActor.length > 0) {
        applyEffects(actor, effectsForActor);
        const existing = actorEffects.get(actor.id) ?? [];
        actorEffects.set(actor.id, [...existing, ...effectsForActor]);
      }
    }
  }

  return {
    previousTick,
    currentTick: world.tick,
    ticksAdvanced,
    day: world.day,
    dayChanged,
    actorEffects,
    globalEffects,
  };
}
