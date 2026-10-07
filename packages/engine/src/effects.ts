// =============================================================================
// Effect — every state change the engine produces is an Effect.
// resolve() and advance() return Effect[]; the Colyseus room applies them.
// This file has ZERO imports — it is the base layer.
// =============================================================================

export type LedgerKind =
  | "PURCHASE"
  | "SALE"
  | "BRIBE"
  | "RENT"
  | "GOVERNMENT_FEE"
  | "STARTING_GRANT"
  | "PENALTY"
  | "REWARD";

// ---------------------------------------------------------------------------
// Individual effect shapes
// ---------------------------------------------------------------------------

/** Debit (negative deltaKobo) or credit (positive) on a player's wallet. */
export type CashEffect = {
  kind: "CASH";
  /** Signed kobo. Negative = debit, positive = credit. Always integer. */
  deltaKobo: number;
  idemKey: string;
  ledgerKind: LedgerKind;
  relatedEntityId?: string;
};

/** Social capital gain or loss. */
export type SocialCapitalEffect = {
  kind: "SOCIAL_CAPITAL";
  delta: number; // signed
};

/** Inventory item quantity change. */
export type InventoryEffect = {
  kind: "INVENTORY";
  itemId: string;
  delta: number; // positive = gain, negative = loss
};

/** Player energy change. */
export type EnergyEffect = {
  kind: "ENERGY";
  delta: number; // signed; engine clamps to [0, 100]
};

/** Successful movement to a new grid tile. */
export type PositionEffect = {
  kind: "POSITION";
  toX: number;
  toY: number;
  enteredZoneId: string | null;
};

/** A bureaucracy file has been opened. */
export type BureaucracyFileEffect = {
  kind: "BUREAUCRACY_FILE_OPENED";
  ruleId: string;
  resolvesAtTick: number;
  feeIdemKey: string;
};

/** Intent was rejected. Colyseus relays this to the client as an error message. */
export type ErrorEffect = {
  kind: "ERROR";
  code: ErrorCode;
  message: string;
};

export type ErrorCode =
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_SOCIAL_CAPITAL"
  | "INSUFFICIENT_ENERGY"
  | "ITEM_NOT_FOUND"
  | "NPC_NOT_FOUND"
  | "INVALID_MOVE"
  | "BLOCKED_TILE"
  | "INVALID_QUANTITY"
  | "BUREAUCRACY_REQUIREMENTS_UNMET"
  | "DUPLICATE_IDEM_KEY"
  | "TRANSIT_UNAVAILABLE"
  | "UNKNOWN_INTENT"
  | "INTERNAL_ERROR";

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type Effect =
  | CashEffect
  | SocialCapitalEffect
  | InventoryEffect
  | EnergyEffect
  | PositionEffect
  | BureaucracyFileEffect
  | ErrorEffect;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isError(effect: Effect): effect is ErrorEffect {
  return effect.kind === "ERROR";
}

export function hasError(effects: Effect[]): boolean {
  return effects.some(isError);
}

export function firstError(effects: Effect[]): ErrorEffect | undefined {
  return effects.find(isError) as ErrorEffect | undefined;
}
