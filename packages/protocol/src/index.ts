// =============================================================================
// @ltm/protocol — Shared message types between web client, Colyseus server,
// and AI service. The client sends ONLY intent messages. The server is the
// sole authority over money, inventory, and social capital.
// =============================================================================

// ---------------------------------------------------------------------------
// Intent messages (Client → Server)
// ---------------------------------------------------------------------------

export type SpatialCoord = {
  x: number;
  y: number;
  lat?: number;
  lng?: number;
};

export type PathWaypoint = {
  x: number;
  y: number;
  lat?: number;
  lng?: number;
  speed?: number;
  roadCategory?: "expressway" | "arterial" | "street" | "close";
};

export type MoveIntent = {
  type: "MOVE";
  toX: number;
  toY: number;
  lat?: number;
  lng?: number;
};

export type BuyIntent = {
  type: "BUY";
  itemId: string;
  /** How many units to buy (must be positive int) */
  quantity: number;
};

export type SellIntent = {
  type: "SELL";
  itemId: string;
  quantity: number;
};

export type TalkIntent = {
  type: "TALK";
  npcInstanceId: string;
};

export type SubmitDocumentIntent = {
  type: "SUBMIT_DOCUMENT";
  bureaucracyRuleId: string;
  /** Inventory item ids the player is attaching to the submission */
  attachedItemIds: string[];
};

export type PayBribeIntent = {
  type: "PAY_BRIBE";
  npcInstanceId: string;
  /** Kobo amount — server will validate player has this, or reject */
  amountKobo: number;
};

export type TransitTier = "ALONG" | "BOLT";

export type TransitIntent = {
  type: "TRANSIT";
  tier: TransitTier;
  toX: number;
  toY: number;
  toDistrictId?: string;
  toLat?: number;
  toLng?: number;
};

export type ClientIntent =
  | MoveIntent
  | BuyIntent
  | SellIntent
  | TalkIntent
  | SubmitDocumentIntent
  | PayBribeIntent
  | TransitIntent;

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

export type ServerAck = {
  type: "ACK";
  idemKey: string;
  x?: number;
  y?: number;
  lat?: number;
  lng?: number;
  seq?: number;
  balanceKobo?: number;
  pathWaypoints?: PathWaypoint[];
  transitTier?: TransitTier;
};

export type ServerError = {
  type: "ERROR";
  code: ErrorCode;
  message: string;
};

export type ErrorCode =
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_SOCIAL_CAPITAL"
  | "ITEM_NOT_FOUND"
  | "NPC_NOT_FOUND"
  | "INVALID_MOVE"
  | "BUREAUCRACY_REQUIREMENTS_UNMET"
  | "RATE_LIMITED"
  | "TRANSIT_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type NpcDialogueMessage = {
  type: "NPC_DIALOGUE";
  npcInstanceId: string;
  archetypeId: string;
  text: string;
  /** Whether the text came from LLM (true) or fallback (false) */
  fromLLM: boolean;
};

export type InventoryUpdate = {
  type: "INVENTORY_UPDATE";
  /** Full inventory snapshot for the player */
  items: InventoryItem[];
};

export type InventoryItem = {
  itemId: string;
  quantity: number;
};

export type WalletUpdate = {
  type: "WALLET_UPDATE";
  /** Authoritative kobo balance from ledger */
  balanceKobo: number;
  socialCapital: number;
};

export type ServerMessage =
  | ServerAck
  | ServerError
  | NpcDialogueMessage
  | InventoryUpdate
  | WalletUpdate;

// ---------------------------------------------------------------------------
// AI Service REST types (Server → AI Service)
// ---------------------------------------------------------------------------

export type AIDialogueRequest = {
  /** Bucketed context hash — used as cache key */
  contextHash: string;
  archetypeId: string;
  /** Zone type the NPC is in */
  zoneType: string;
  /** Opaque context tokens — never raw player data */
  contextTokens: string[];
};

export type AIDialogueResponse = {
  text: string;
  fromCache: boolean;
};

// ---------------------------------------------------------------------------
// Ledger entry types (shared for logging/audit)
// ---------------------------------------------------------------------------

export type LedgerEntryKind =
  | "PURCHASE"
  | "SALE"
  | "BRIBE"
  | "RENT"
  | "GOVERNMENT_FEE"
  | "STARTING_GRANT"
  | "PENALTY"
  | "REWARD";

export type LedgerEntryRecord = {
  id: string;
  accountId: string;
  kind: LedgerEntryKind;
  amountKobo: number;
  /** Must be negative for debits */
  direction: "CREDIT" | "DEBIT";
  idemKey: string;
  relatedEntityId: string | null;
  createdAt: Date;
};
