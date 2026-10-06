// =============================================================================
// Rule Definition Types — parsed from city-pack rules.json
// No imports from apps/* or I/O.
// =============================================================================

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/** When does this rule fire? */
export type RuleTrigger =
  | "dayTick"      // once per in-game day per player
  | "onMove"       // after each successful position change
  | "onBuy"        // after a successful purchase
  | "onSell"       // after a successful sale
  | "onTalk"       // after talking to an NPC
  | "onBribeSuccess" // after a bribe is accepted
  | "onBureaucracyApproved" // when a bureaucracy file resolves as APPROVED
  | "onBureaucracyRejected";

// ---------------------------------------------------------------------------
// Condition DSL
// ---------------------------------------------------------------------------

/** A resolved value node — either a path into eval context or a literal. */
export type PathNode = { path: string }; // e.g. "actor.home.district.tier"
export type LiteralNode = { literal: unknown };
export type ValueNode = PathNode | LiteralNode;

/** Comparison operators */
export type CompareCondition = {
  op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte";
  left: ValueNode;
  right: ValueNode;
};

/** Logical operators */
export type AndCondition = { op: "and"; conditions: ConditionNode[] };
export type OrCondition = { op: "or"; conditions: ConditionNode[] };
export type NotCondition = { op: "not"; condition: ConditionNode };
export type AlwaysCondition = { op: "always" };
export type NeverCondition = { op: "never" };

export type ConditionNode =
  | CompareCondition
  | AndCondition
  | OrCondition
  | NotCondition
  | AlwaysCondition
  | NeverCondition;

// ---------------------------------------------------------------------------
// Rule Effect (declarative JSON form — different from engine Effect)
// ---------------------------------------------------------------------------

export type RuleEffectSpec =
  | { kind: "ENERGY"; delta: number }
  | { kind: "SOCIAL_CAPITAL"; delta: number }
  | { kind: "CASH"; deltaKobo: number; ledgerKind: string }
  | { kind: "INVENTORY"; itemId: string; delta: number };

// ---------------------------------------------------------------------------
// Rule Definition
// ---------------------------------------------------------------------------

export type RuleDefinition = {
  id: string;
  displayName: string;
  description?: string;
  trigger: RuleTrigger;
  condition: ConditionNode;
  effects: RuleEffectSpec[];
  /** Priority — higher fires first when multiple rules share a trigger */
  priority?: number;
  meta?: Record<string, unknown>;
};

export type RulesFile = {
  schemaVersion: string;
  rules: RuleDefinition[];
};
