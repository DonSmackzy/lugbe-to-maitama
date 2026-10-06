// =============================================================================
// Rule Evaluator — Pure evaluator for declarative City Pack rules.
// Zero imports from apps/*, window, fs, or any I/O.
// =============================================================================

import type { ConditionNode, RuleDefinition, RuleEffectSpec, RuleTrigger, ValueNode } from "./types.js";
import type { Effect, LedgerKind } from "../effects.js";

/**
 * Resolves a ValueNode (path or literal) against the evaluation context.
 */
export function resolveValue(node: ValueNode, ctx: Record<string, unknown>): unknown {
  if ("literal" in node) {
    return node.literal;
  }

  if ("path" in node) {
    const parts = node.path.split(".");
    let curr: unknown = ctx;
    for (const part of parts) {
      if (curr === null || curr === undefined || typeof curr !== "object") {
        return undefined;
      }
      curr = (curr as Record<string, unknown>)[part];
    }
    return curr;
  }

  return undefined;
}

/**
 * Evaluates a condition AST against the evaluation context.
 */
export function evaluateCondition(condition: ConditionNode, ctx: Record<string, unknown>): boolean {
  switch (condition.op) {
    case "always":
      return true;
    case "never":
      return false;
    case "not":
      return !evaluateCondition(condition.condition, ctx);
    case "and":
      return condition.conditions.every((c) => evaluateCondition(c, ctx));
    case "or":
      return condition.conditions.some((c) => evaluateCondition(c, ctx));
    case "eq": {
      const left = resolveValue(condition.left, ctx);
      const right = resolveValue(condition.right, ctx);
      return left === right;
    }
    case "neq": {
      const left = resolveValue(condition.left, ctx);
      const right = resolveValue(condition.right, ctx);
      return left !== right;
    }
    case "gt": {
      const left = Number(resolveValue(condition.left, ctx));
      const right = Number(resolveValue(condition.right, ctx));
      return left > right;
    }
    case "lt": {
      const left = Number(resolveValue(condition.left, ctx));
      const right = Number(resolveValue(condition.right, ctx));
      return left < right;
    }
    case "gte": {
      const left = Number(resolveValue(condition.left, ctx));
      const right = Number(resolveValue(condition.right, ctx));
      return left >= right;
    }
    case "lte": {
      const left = Number(resolveValue(condition.left, ctx));
      const right = Number(resolveValue(condition.right, ctx));
      return left <= right;
    }
    default:
      return false;
  }
}

/**
 * Evaluates all rules matching the given trigger and returns converted Effects.
 */
export function evaluateRules(
  trigger: RuleTrigger,
  rules: RuleDefinition[],
  ctx: Record<string, unknown>,
  idemPrefix = "rule"
): Effect[] {
  const matchingRules = rules
    .filter((r) => r.trigger === trigger)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const effects: Effect[] = [];

  for (const rule of matchingRules) {
    if (evaluateCondition(rule.condition, ctx)) {
      for (let i = 0; i < rule.effects.length; i++) {
        const spec = rule.effects[i];
        if (spec) {
          effects.push(specToEffect(spec, `${idemPrefix}_${rule.id}_${i}`));
        }
      }
    }
  }

  return effects;
}

/**
 * Converts a declarative RuleEffectSpec into an executable Engine Effect.
 */
export function specToEffect(spec: RuleEffectSpec, idemKey: string): Effect {
  switch (spec.kind) {
    case "ENERGY":
      return { kind: "ENERGY", delta: spec.delta };
    case "SOCIAL_CAPITAL":
      return { kind: "SOCIAL_CAPITAL", delta: spec.delta };
    case "CASH":
      return {
        kind: "CASH",
        deltaKobo: spec.deltaKobo,
        idemKey,
        ledgerKind: (spec.ledgerKind as LedgerKind) || "PENALTY",
      };
    case "INVENTORY":
      return {
        kind: "INVENTORY",
        itemId: spec.itemId,
        delta: spec.delta,
      };
  }
}
