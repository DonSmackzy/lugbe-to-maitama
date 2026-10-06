// =============================================================================
// resolve — Pure function: (world, actor, intent) -> Effect[]
// Returns the exact array of Effects to be applied to the world/actor.
// Zero imports from apps/*, DOM, window, or fs.
// =============================================================================

import type { ClientIntent } from "@ltm/protocol";
import type { ActorState, WorldState } from "./state.js";
import type { Effect, CashEffect, InventoryEffect, PositionEffect, SocialCapitalEffect, BureaucracyFileEffect } from "./effects.js";
import { hasError } from "./effects.js";
import { evaluateRules } from "./rules/evaluator.js";

export type ExtendedClientIntent = ClientIntent & {
  idemKey?: string;
};

/**
 * Pure evaluation function. Resolves an actor's intent in the world and produces
 * an array of Effects. Does NOT mutate world or actor.
 */
export function resolve(
  world: WorldState,
  actor: ActorState,
  intent: ExtendedClientIntent,
  idemKey?: string
): Effect[] {
  const effectiveIdemKey = idemKey ?? intent.idemKey ?? "";

  // Check duplicate idempotency key if provided
  if (effectiveIdemKey && actor.processedIdemKeys.has(effectiveIdemKey)) {
    return [
      {
        kind: "ERROR",
        code: "DUPLICATE_IDEM_KEY",
        message: `Idempotency key '${effectiveIdemKey}' has already been processed`,
      },
    ];
  }

  switch (intent.type) {
    case "MOVE":
      return resolveMove(world, actor, intent);
    case "BUY":
      return resolveBuy(world, actor, intent, effectiveIdemKey);
    case "SELL":
      return resolveSell(world, actor, intent, effectiveIdemKey);
    case "TALK":
      return resolveTalk(world, actor, intent);
    case "SUBMIT_DOCUMENT":
      return resolveSubmitDocument(world, actor, intent, effectiveIdemKey);
    case "PAY_BRIBE":
      return resolvePayBribe(world, actor, intent, effectiveIdemKey);
    default:
      return [
        {
          kind: "ERROR",
          code: "UNKNOWN_INTENT",
          message: `Unknown intent type: ${(intent as { type: string }).type}`,
        },
      ];
  }
}

// ---------------------------------------------------------------------------
// Intent Resolvers
// ---------------------------------------------------------------------------

function resolveMove(
  world: WorldState,
  actor: ActorState,
  intent: Extract<ClientIntent, { type: "MOVE" }>
): Effect[] {
  const result = world.navGrid.validateMove(actor.position, { x: intent.toX, y: intent.toY });
  if (!result.ok) {
    return [
      {
        kind: "ERROR",
        code: result.code,
        message: result.reason,
      },
    ];
  }

  const effects: Effect[] = [
    {
      kind: "POSITION",
      toX: intent.toX,
      toY: intent.toY,
      enteredZoneId: result.enteredZoneId,
    },
  ];

  // Evaluate onMove rules
  const currentDistrict = result.enteredDistrictId
    ? world.navGrid.getDistrictById(result.enteredDistrictId)
    : undefined;

  const ruleCtx = {
    world,
    actor: {
      ...actor,
      currentDistrict,
    },
    toX: intent.toX,
    toY: intent.toY,
  };

  const ruleEffects = evaluateRules("onMove", world.rules, ruleCtx, `move_${world.tick}`);
  effects.push(...ruleEffects);

  return effects;
}

function resolveBuy(
  world: WorldState,
  actor: ActorState,
  intent: Extract<ClientIntent, { type: "BUY" }>,
  idemKey: string
): Effect[] {
  if (!Number.isInteger(intent.quantity) || intent.quantity <= 0) {
    return [
      {
        kind: "ERROR",
        code: "INVALID_QUANTITY",
        message: `Purchase quantity must be positive integer, got ${intent.quantity}`,
      },
    ];
  }

  const item = world.cityPack.items.find((i) => i.id === intent.itemId);
  if (!item) {
    return [
      {
        kind: "ERROR",
        code: "ITEM_NOT_FOUND",
        message: `Item '${intent.itemId}' not found in city pack catalog`,
      },
    ];
  }

  // Calculate pricing based on zone and market multiplier
  const zone = world.navGrid.getZoneAt(actor.position.x, actor.position.y);
  const zoneMultiplier = zone ? (world.marketMultipliers.get(zone.id) ?? 1.0) : 1.0;
  const itemMultiplier = world.marketMultipliers.get(item.id) ?? 1.0;
  const unitPriceKobo = Math.round(item.basePriceKobo * zoneMultiplier * itemMultiplier);
  const totalCostKobo = unitPriceKobo * intent.quantity;

  if (actor.balanceKobo < totalCostKobo) {
    return [
      {
        kind: "ERROR",
        code: "INSUFFICIENT_FUNDS",
        message: `Insufficient funds: needed ${totalCostKobo} kobo, balance is ${actor.balanceKobo} kobo`,
      },
    ];
  }

  const resolvedKey = idemKey || `buy_${actor.id}_${intent.itemId}_${world.tick}`;

  const effects: Effect[] = [
    {
      kind: "CASH",
      deltaKobo: -totalCostKobo,
      idemKey: resolvedKey,
      ledgerKind: "PURCHASE",
      relatedEntityId: item.id,
    },
    {
      kind: "INVENTORY",
      itemId: item.id,
      delta: intent.quantity,
    },
  ];

  // Evaluate onBuy rules
  const currentDistrict = world.navGrid.getDistrictAt(actor.position.x, actor.position.y);
  const ruleCtx = {
    world,
    actor: {
      ...actor,
      currentDistrict,
    },
    item,
    quantity: intent.quantity,
    totalCostKobo,
  };

  const ruleEffects = evaluateRules("onBuy", world.rules, ruleCtx, `buy_${world.tick}`);
  effects.push(...ruleEffects);

  return effects;
}

function resolveSell(
  world: WorldState,
  actor: ActorState,
  intent: Extract<ClientIntent, { type: "SELL" }>,
  idemKey: string
): Effect[] {
  if (!Number.isInteger(intent.quantity) || intent.quantity <= 0) {
    return [
      {
        kind: "ERROR",
        code: "INVALID_QUANTITY",
        message: `Sale quantity must be positive integer, got ${intent.quantity}`,
      },
    ];
  }

  const currentQty = actor.inventory.get(intent.itemId) ?? 0;
  if (currentQty < intent.quantity) {
    return [
      {
        kind: "ERROR",
        code: "ITEM_NOT_FOUND",
        message: `Insufficient inventory: have ${currentQty}, trying to sell ${intent.quantity}`,
      },
    ];
  }

  const item = world.cityPack.items.find((i) => i.id === intent.itemId);
  if (!item) {
    return [
      {
        kind: "ERROR",
        code: "ITEM_NOT_FOUND",
        message: `Item '${intent.itemId}' not found in city pack catalog`,
      },
    ];
  }

  // Resale pricing: base resale margin ~ 85%
  const zone = world.navGrid.getZoneAt(actor.position.x, actor.position.y);
  const zoneMultiplier = zone ? (world.marketMultipliers.get(zone.id) ?? 1.0) : 1.0;
  const unitPriceKobo = Math.round(item.basePriceKobo * 0.85 * zoneMultiplier);
  const totalRevenueKobo = unitPriceKobo * intent.quantity;
  const resolvedKey = idemKey || `sell_${actor.id}_${intent.itemId}_${world.tick}`;

  const effects: Effect[] = [
    {
      kind: "CASH",
      deltaKobo: totalRevenueKobo,
      idemKey: resolvedKey,
      ledgerKind: "SALE",
      relatedEntityId: item.id,
    },
    {
      kind: "INVENTORY",
      itemId: item.id,
      delta: -intent.quantity,
    },
  ];

  // Evaluate onSell rules
  const currentDistrict = world.navGrid.getDistrictAt(actor.position.x, actor.position.y);
  const ruleCtx = {
    world,
    actor: {
      ...actor,
      currentDistrict,
    },
    item,
    quantity: intent.quantity,
    totalRevenueKobo,
  };

  const ruleEffects = evaluateRules("onSell", world.rules, ruleCtx, `sell_${world.tick}`);
  effects.push(...ruleEffects);

  return effects;
}

function resolveTalk(
  world: WorldState,
  actor: ActorState,
  intent: Extract<ClientIntent, { type: "TALK" }>
): Effect[] {
  const npc = world.npcs.get(intent.npcInstanceId);
  if (!npc) {
    return [
      {
        kind: "ERROR",
        code: "NPC_NOT_FOUND",
        message: `NPC instance '${intent.npcInstanceId}' not found`,
      },
    ];
  }

  const dx = Math.abs(actor.position.x - npc.position.x);
  const dy = Math.abs(actor.position.y - npc.position.y);
  if (dx > 2 || dy > 2) {
    return [
      {
        kind: "ERROR",
        code: "INVALID_MOVE",
        message: `Too far from NPC (${dx},${dy}). Must be within 2 tiles to interact`,
      },
    ];
  }

  const archetype = world.cityPack.npcArchetypes.find((a) => a.id === npc.archetypeId);
  if (!archetype) {
    return [
      {
        kind: "ERROR",
        code: "NPC_NOT_FOUND",
        message: `Archetype '${npc.archetypeId}' not found in city pack`,
      },
    ];
  }

  const effects: Effect[] = [
    {
      kind: "SOCIAL_CAPITAL",
      delta: archetype.interactionScModifier,
    },
  ];

  // Evaluate onTalk rules
  const currentDistrict = world.navGrid.getDistrictAt(actor.position.x, actor.position.y);
  const ruleCtx = {
    world,
    actor: {
      ...actor,
      currentDistrict,
    },
    npc,
    archetype,
  };

  const ruleEffects = evaluateRules("onTalk", world.rules, ruleCtx, `talk_${world.tick}`);
  effects.push(...ruleEffects);

  return effects;
}

function resolveSubmitDocument(
  world: WorldState,
  actor: ActorState,
  intent: Extract<ClientIntent, { type: "SUBMIT_DOCUMENT" }>,
  idemKey: string
): Effect[] {
  const rule = world.cityPack.bureaucracyRules.find((r) => r.id === intent.bureaucracyRuleId);
  if (!rule) {
    return [
      {
        kind: "ERROR",
        code: "BUREAUCRACY_REQUIREMENTS_UNMET",
        message: `Bureaucracy obstacle '${intent.bureaucracyRuleId}' not found`,
      },
    ];
  }

  if (actor.balanceKobo < rule.feeKobo) {
    return [
      {
        kind: "ERROR",
        code: "INSUFFICIENT_FUNDS",
        message: `Bureaucracy filing fee requires ${rule.feeKobo} kobo, actor balance is ${actor.balanceKobo} kobo`,
      },
    ];
  }

  if (actor.socialCapital < rule.minSocialCapital) {
    return [
      {
        kind: "ERROR",
        code: "INSUFFICIENT_SOCIAL_CAPITAL",
        message: `Filing requires ${rule.minSocialCapital} social capital, actor has ${actor.socialCapital}`,
      },
    ];
  }

  for (const requiredItemId of rule.requiredItemIds) {
    const qty = actor.inventory.get(requiredItemId) ?? 0;
    if (qty < 1) {
      return [
        {
          kind: "ERROR",
          code: "BUREAUCRACY_REQUIREMENTS_UNMET",
          message: `Missing required bureaucratic item: '${requiredItemId}'`,
        },
      ];
    }
  }

  const resolvedKey = idemKey || `bureaucracy_${actor.id}_${rule.id}_${world.tick}`;

  const effects: Effect[] = [
    {
      kind: "CASH",
      deltaKobo: -rule.feeKobo,
      idemKey: resolvedKey,
      ledgerKind: "GOVERNMENT_FEE",
      relatedEntityId: rule.id,
    },
    {
      kind: "BUREAUCRACY_FILE_OPENED",
      ruleId: rule.id,
      resolvesAtTick: world.tick + rule.processingTicks,
      feeIdemKey: resolvedKey,
    },
  ];

  return effects;
}

function resolvePayBribe(
  world: WorldState,
  actor: ActorState,
  intent: Extract<ClientIntent, { type: "PAY_BRIBE" }>,
  idemKey: string
): Effect[] {
  if (!Number.isInteger(intent.amountKobo) || intent.amountKobo <= 0) {
    return [
      {
        kind: "ERROR",
        code: "INSUFFICIENT_FUNDS",
        message: "Bribe amount must be a positive integer in kobo",
      },
    ];
  }

  if (actor.balanceKobo < intent.amountKobo) {
    return [
      {
        kind: "ERROR",
        code: "INSUFFICIENT_FUNDS",
        message: `Insufficient funds to pay bribe: needed ${intent.amountKobo} kobo, have ${actor.balanceKobo} kobo`,
      },
    ];
  }

  const npc = world.npcs.get(intent.npcInstanceId);
  if (!npc) {
    return [
      {
        kind: "ERROR",
        code: "NPC_NOT_FOUND",
        message: `NPC '${intent.npcInstanceId}' not found`,
      },
    ];
  }

  const resolvedKey = idemKey || `bribe_${actor.id}_${intent.npcInstanceId}_${world.tick}`;
  const scGain = Math.min(20, Math.floor(intent.amountKobo / 50000)); // +1 SC per 500 Naira bribe

  const effects: Effect[] = [
    {
      kind: "CASH",
      deltaKobo: -intent.amountKobo,
      idemKey: resolvedKey,
      ledgerKind: "BRIBE",
      relatedEntityId: intent.npcInstanceId,
    },
    {
      kind: "SOCIAL_CAPITAL",
      delta: scGain,
    },
  ];

  const ruleCtx = {
    world,
    actor,
    npc,
    bribeKobo: intent.amountKobo,
  };
  const ruleEffects = evaluateRules("onBribeSuccess", world.rules, ruleCtx, `bribe_${world.tick}`);
  effects.push(...ruleEffects);

  return effects;
}

// ---------------------------------------------------------------------------
// Pure State Mutation / Application
// ---------------------------------------------------------------------------

/**
 * Applies an array of effects to an actor.
 * ATOMIC GUARANTEE: If any effect in the array is an ERROR, NO state changes are applied.
 * Returns true if applied successfully, false if rolled back.
 */
export function applyEffects(actor: ActorState, effects: Effect[]): boolean {
  if (hasError(effects)) {
    return false; // Roll back entirely
  }

  for (const effect of effects) {
    switch (effect.kind) {
      case "CASH":
        actor.balanceKobo += effect.deltaKobo;
        if (effect.idemKey) {
          actor.processedIdemKeys.add(effect.idemKey);
        }
        break;
      case "INVENTORY": {
        const curr = actor.inventory.get(effect.itemId) ?? 0;
        const updated = curr + effect.delta;
        if (updated <= 0) {
          actor.inventory.delete(effect.itemId);
        } else {
          actor.inventory.set(effect.itemId, updated);
        }
        break;
      }
      case "ENERGY":
        actor.energy = Math.max(0, Math.min(100, actor.energy + effect.delta));
        break;
      case "SOCIAL_CAPITAL":
        actor.socialCapital += effect.delta;
        break;
      case "POSITION":
        actor.position = { x: effect.toX, y: effect.toY };
        break;
      case "BUREAUCRACY_FILE_OPENED":
        actor.pendingFiles.set(effect.ruleId, effect.resolvesAtTick);
        if (effect.feeIdemKey) {
          actor.processedIdemKeys.add(effect.feeIdemKey);
        }
        break;
      case "ERROR":
        // Should not be reached due to hasError check
        break;
    }
  }

  return true;
}
