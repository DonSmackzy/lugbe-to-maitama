import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Kobo-denominated money. Always integer. Never use floats for money. */
export const KoboSchema = z.number().int().nonnegative().brand("Kobo");
export type Kobo = z.infer<typeof KoboSchema>;

/** Social capital score — can be negative (disgraced) to 1_000_000 (senator-tier) */
export const SocialCapitalSchema = z.number().int().min(-999_999).max(1_000_000).brand("SocialCapital");
export type SocialCapital = z.infer<typeof SocialCapitalSchema>;

/** 2D grid coordinates in the city */
export const CoordSchema = z.object({ x: z.number().int(), y: z.number().int() });
export type Coord = z.infer<typeof CoordSchema>;

// ---------------------------------------------------------------------------
// Zone
// ---------------------------------------------------------------------------

export const ZoneTypeSchema = z.enum([
  "residential",
  "commercial",
  "government",
  "transport_hub",
  "market",
  "industrial",
  "park",
  "restricted",
]);
export type ZoneType = z.infer<typeof ZoneTypeSchema>;

export const ZoneSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/, "Zone id must be snake_case"),
  /** Human-readable name for UI only — never used in engine logic */
  displayName: z.string().min(1).max(64),
  type: ZoneTypeSchema,
  /** Bounding rectangle in grid units */
  bounds: z.object({
    topLeft: CoordSchema,
    bottomRight: CoordSchema,
  }),
  /** Base rent per game-tick in kobo */
  baseRentKobo: KoboSchema,
  /** Ambient NPC density (0-1) */
  npcDensity: z.number().min(0).max(1),
  /** Custom metadata slots for city-pack extensions */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type Zone = z.infer<typeof ZoneSchema>;

// ---------------------------------------------------------------------------
// Item / Trade Good
// ---------------------------------------------------------------------------

export const ItemCategorySchema = z.enum([
  "food",
  "transport",
  "bribe",
  "document",
  "luxury",
  "tool",
  "contraband",
]);
export type ItemCategory = z.infer<typeof ItemCategorySchema>;

export const ItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  displayName: z.string().min(1).max(64),
  category: ItemCategorySchema,
  /** Base price in kobo (market fluctuates around this) */
  basePriceKobo: KoboSchema,
  /** Can this item be stacked in inventory? */
  stackable: z.boolean(),
  /** Max stack size (only relevant if stackable) */
  maxStack: z.number().int().positive().optional(),
  /** Weight in arbitrary units for carry-capacity calculations */
  weightUnits: z.number().nonnegative(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type Item = z.infer<typeof ItemSchema>;

// ---------------------------------------------------------------------------
// NPC Archetype
// ---------------------------------------------------------------------------

export const NpcArchetypeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  displayName: z.string().min(1).max(64),
  /** Which zones this archetype spawns in */
  spawnZoneTypes: z.array(ZoneTypeSchema).min(1),
  /** Dialogue fallback lines — used when LLM cache misses & timeout */
  fallbackDialogue: z.array(z.string().min(1)).min(1),
  /** Social capital modifier when player successfully interacts */
  interactionScModifier: SocialCapitalSchema,
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type NpcArchetype = z.infer<typeof NpcArchetypeSchema>;

// ---------------------------------------------------------------------------
// Bureaucracy Rule
// ---------------------------------------------------------------------------

/** A bureaucratic obstacle the player must navigate */
export const BureaucracyRuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  displayName: z.string().min(1).max(128),
  /** Which items (by id) are required to clear this obstacle */
  requiredItemIds: z.array(z.string()),
  /** Flat fee in kobo */
  feeKobo: KoboSchema,
  /** How many game-ticks the process takes */
  processingTicks: z.number().int().positive(),
  /** Social capital gate — player needs at least this much */
  minSocialCapital: SocialCapitalSchema,
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type BureaucracyRule = z.infer<typeof BureaucracyRuleSchema>;

// ---------------------------------------------------------------------------
// City Pack (root schema)
// ---------------------------------------------------------------------------

export const CityPackSchema = z.object({
  /** Semver */
  schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Unique pack identifier — snake_case */
  packId: z.string().regex(/^[a-z0-9_]+$/),
  /** Display name for UI */
  displayName: z.string().min(1).max(128),
  /** Grid dimensions in tiles */
  gridWidth: z.number().int().positive(),
  gridHeight: z.number().int().positive(),
  /** Starting cash in kobo for a new player */
  startingCashKobo: KoboSchema,
  /** Starting social capital */
  startingSocialCapital: SocialCapitalSchema,
  zones: z.array(ZoneSchema).min(1),
  items: z.array(ItemSchema).min(1),
  npcArchetypes: z.array(NpcArchetypeSchema).min(1),
  bureaucracyRules: z.array(BureaucracyRuleSchema).min(1),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type CityPack = z.infer<typeof CityPackSchema>;

// ---------------------------------------------------------------------------
// GIS & Cultural POI Overlays
// ---------------------------------------------------------------------------

/** Real-world WGS84 geographic coordinate */
export const GeoCoordSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoCoord = z.infer<typeof GeoCoordSchema>;

export const CulturePOICategorySchema = z.enum([
  "food_and_nightlife",
  "transit_hub",
  "commercial_strip",
  "financial_blackmarket",
  "cultural_landmark",
]);
export type CulturePOICategory = z.infer<typeof CulturePOICategorySchema>;

export const CulturePerkSchema = z.object({
  type: z.string().min(1),
  description: z.string().min(1),
  energyDelta: z.number().optional(),
  socialCapitalDelta: z.number().optional(),
  cashMultiplier: z.number().optional(),
  fareDiscountMultiplier: z.number().optional(),
});
export type CulturePerk = z.infer<typeof CulturePerkSchema>;

export const CulturePOISchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/, "POI id must be snake_case"),
  displayName: z.string().min(1).max(128),
  category: CulturePOICategorySchema,
  geo: GeoCoordSchema,
  gridCoord: CoordSchema.optional(),
  districtId: z.string().optional(),
  description: z.string().min(1),
  culturalPerk: CulturePerkSchema.optional(),
  tags: z.array(z.string()).default([]),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type CulturePOI = z.infer<typeof CulturePOISchema>;

export const CultureOverlaySchema = z.object({
  schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  cityId: z.string().min(1),
  displayName: z.string().min(1),
  pois: z.array(CulturePOISchema).min(1),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type CultureOverlay = z.infer<typeof CultureOverlaySchema>;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Parse and validate a raw JSON object as a CityPack.
 * Throws a descriptive ZodError on failure.
 */
export function parseCityPack(raw: unknown): CityPack {
  return CityPackSchema.parse(raw);
}

/**
 * Parse and validate a raw JSON object as a CultureOverlay.
 */
export function parseCultureOverlay(raw: unknown): CultureOverlay {
  return CultureOverlaySchema.parse(raw);
}
