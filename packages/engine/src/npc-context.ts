// =============================================================================
// npcContext — Generates privacy-preserving, bucketed context for AI dialogue.
// Produces a deterministic context hash for Redis caching in apps/ai-service.
// Zero imports from apps/*, DOM, window, or fs.
// =============================================================================

import type { WorldState, ActorState } from "./state.js";

export type WealthTier =
  | "struggling"       // < 1,000 NGN (< 100,000 kobo)
  | "working_class"    // 1,000 - 10,000 NGN
  | "middle_class"     // 10,000 - 100,000 NGN
  | "affluent"         // 100,000 - 1,000,000 NGN
  | "elite";           // > 1,000,000 NGN

export type ReputationTier =
  | "disgraced"        // < 0 SC
  | "unknown_commuter" // 0 - 50 SC
  | "street_smart"     // 51 - 200 SC
  | "connected"        // 201 - 1,000 SC
  | "godfather_tier";  // > 1,000 SC

export type NPCContext = {
  npcInstanceId: string;
  archetypeId: string;
  archetypeDisplayName: string;
  actorId: string;
  zoneId: string;
  zoneType: string;
  districtId: string;
  districtTier: string;
  wealthTier: WealthTier;
  reputationTier: ReputationTier;
  homeDistrictId: string;
  homeDistrictTier: string;
  fallbackDialogue: string[];
  contextTokens: string[];
  contextHash: string;
};

export function getWealthTier(balanceKobo: number): WealthTier {
  if (balanceKobo < 100_000) return "struggling";
  if (balanceKobo < 1_000_000) return "working_class";
  if (balanceKobo < 10_000_000) return "middle_class";
  if (balanceKobo < 100_000_000) return "affluent";
  return "elite";
}

export function getReputationTier(socialCapital: number): ReputationTier {
  if (socialCapital < 0) return "disgraced";
  if (socialCapital <= 50) return "unknown_commuter";
  if (socialCapital <= 200) return "street_smart";
  if (socialCapital <= 1_000) return "connected";
  return "godfather_tier";
}

/**
 * Fast deterministic string hash (djb2) for cache keys.
 * Pure JS, no crypto dependency required.
 */
function fastHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Builds bucketed AI dialogue context for an NPC interaction.
 */
export function npcContext(
  world: WorldState,
  actor: ActorState,
  npcId: string
): NPCContext | null {
  const npc = world.npcs.get(npcId);
  if (!npc) return null;

  const archetype = world.cityPack.npcArchetypes.find((a) => a.id === npc.archetypeId);
  if (!archetype) return null;

  const zone = world.navGrid.getZoneAt(npc.position.x, npc.position.y);
  const district = world.navGrid.getDistrictAt(npc.position.x, npc.position.y);

  const wealthTier = getWealthTier(actor.balanceKobo);
  const reputationTier = getReputationTier(actor.socialCapital);
  const homeTier = actor.home.district?.tier ?? "unknown";

  const contextTokens = [
    `archetype:${archetype.id}`,
    `zone:${zone?.type ?? "unknown"}`,
    `district:${district?.id ?? "unknown"}`,
    `wealth:${wealthTier}`,
    `reputation:${reputationTier}`,
    `home_tier:${homeTier}`,
  ];

  const rawKey = contextTokens.join("|");
  const contextHash = fastHash(rawKey);

  return {
    npcInstanceId: npc.instanceId,
    archetypeId: archetype.id,
    archetypeDisplayName: archetype.displayName,
    actorId: actor.id,
    zoneId: zone?.id ?? "unknown",
    zoneType: zone?.type ?? "unknown",
    districtId: district?.id ?? "unknown",
    districtTier: district?.tier ?? "unknown",
    wealthTier,
    reputationTier,
    homeDistrictId: actor.home.districtId,
    homeDistrictTier: homeTier,
    fallbackDialogue: archetype.fallbackDialogue,
    contextTokens,
    contextHash,
  };
}
