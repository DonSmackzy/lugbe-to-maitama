// =============================================================================
// @ltm/engine — Transit System
// Models Abuja's dual-tier commuter transit network:
// 1. "Along" — Traditional public commercial commuter buses/taxis (Airport Road,
//    Karu corridor, Lugbe). Affordable (1.0x fare), causes commuter fatigue (-8 energy),
//    dominates satellite hubs, barred from high-security / apex zones.
// 2. "Bolt" — Premium private ride-hailing tier. Significantly higher fare (6.0x+ multiplier),
//    air-conditioned comfort (0 fatigue, +2 SC in elite districts), heavily favored in
//    highbrow destination zones (Maitama, Asokoro), restricted for local satellite trips.
// =============================================================================

import type { TransitTier, TransitIntent } from "@ltm/protocol";
import type { ActorState, WorldState } from "./state.js";
import type { Effect, CashEffect, PositionEffect, EnergyEffect, SocialCapitalEffect, ErrorEffect } from "./effects.js";
import type { District } from "./nav-grid.js";
import type { Coord } from "@ltm/city-schema";

export const BASE_TRANSIT_FARE_KOBO = 50000; // ₦500.00 base commuter fare
export const ALONG_FARE_MULTIPLIER = 1.0; // ₦500.00 standard Along fare
export const BOLT_FARE_MULTIPLIER = 6.0; // ₦3,000.00 premium Bolt base fare (significantly higher)

export const ALONG_ENERGY_DELTA = -8; // Crowded, hot, hectic commuter fatigue
export const BOLT_ENERGY_DELTA = 0; // AC comfort, zero fatigue penalty
export const BOLT_HIGHBROW_SC_BONUS = 2; // Arriving in style in Maitama / Asokoro

export const HIGHBROW_DISTRICT_IDS = new Set(["maitama", "asokoro"]);
export const SATELLITE_DISTRICT_IDS = new Set(["lugbe", "karu", "gwarinpa"]);
export const APEX_RESTRICTED_DISTRICT_IDS = new Set(["the_villa", "aso_rock"]);

export type TransitAvailabilityResult =
  | { available: true }
  | { available: false; reason: string };

/**
 * Checks whether a given transit tier is available for a trip from origin to destination.
 */
export function isTransitAvailable(
  tier: TransitTier,
  fromDistrict: District | undefined,
  toDistrict: District | undefined,
  actor: ActorState
): TransitAvailabilityResult {
  const fromId = fromDistrict?.id?.toLowerCase() ?? "";
  const toId = toDistrict?.id?.toLowerCase() ?? "";
  const toTier = toDistrict?.tier;

  // 1. Apex / restricted zones check (The Villa, Aso Rock)
  if (APEX_RESTRICTED_DISTRICT_IDS.has(toId) || toTier === "apex" || toTier === "restricted") {
    if (tier === "ALONG") {
      return {
        available: false,
        reason: "Commercial Along buses are strictly prohibited from entering restricted diplomatic and presidential zones.",
      };
    }
    // Bolt also cannot enter apex sanctum without required entry clearance / social capital
    if (toDistrict?.entryRequirements) {
      const minSc = toDistrict.entryRequirements.minSocialCapital ?? 0;
      const reqItem = toDistrict.entryRequirements.requiredItem;
      if (actor.socialCapital < minSc) {
        return {
          available: false,
          reason: `Bolt driver cannot clear state security checkpoint at ${toDistrict.displayName}: requires at least ${minSc} Social Capital.`,
        };
      }
      if (reqItem && !actor.inventory.has(reqItem)) {
        return {
          available: false,
          reason: `Bolt driver cannot clear checkpoint without required entry permit: '${reqItem}'.`,
        };
      }
    }
  }

  // 2. Along Transit Rules
  if (tier === "ALONG") {
    // Commercial Along vehicles dominate satellite hubs (Lugbe, Karu, Gwarinpa) and midtown routes (Wuse, Garki).
    // Along is barred from direct inner drop-offs in exclusive highbrow residential zones (Maitama, Asokoro).
    if (HIGHBROW_DISTRICT_IDS.has(toId)) {
      return {
        available: false,
        reason: `Commercial Along buses do not operate direct drops within highbrow residential estates in ${toDistrict?.displayName || "this area"}. Use Bolt ride-hailing or alight at midtown terminals.`,
      };
    }

    return { available: true };
  }

  // 3. Bolt Ride-Hailing Rules
  if (tier === "BOLT") {
    // Heavily favored in highbrow zones (Maitama, Asokoro) and core/midtown corridors.
    const isToHighbrow = HIGHBROW_DISTRICT_IDS.has(toId) || toTier === "core";
    const isFromHighbrow = HIGHBROW_DISTRICT_IDS.has(fromId) || fromDistrict?.tier === "core";

    const isFromSatellite = SATELLITE_DISTRICT_IDS.has(fromId) || fromDistrict?.tier === "satellite";
    const isToSatellite = SATELLITE_DISTRICT_IDS.has(toId) || toTier === "satellite";

    // Restrict Bolt for purely local trips within satellite hubs (e.g. Lugbe -> Lugbe)
    // unless the commuter has high social capital (street elite / VIP)
    if (isFromSatellite && isToSatellite && !isToHighbrow && !isFromHighbrow) {
      if (actor.socialCapital < 100) {
        return {
          available: false,
          reason: "Bolt ride-hailing is unavailable for local commuter hops within satellite hubs like Lugbe. Please board an Along.",
        };
      }
    }

    return { available: true };
  }

  return { available: false, reason: `Unknown transit tier: ${tier}` };
}

/**
 * Calculates the fare in kobo for a transit journey based on tier and distance.
 */
export function calculateTransitFare(
  tier: TransitTier,
  fromCoord: Coord,
  toCoord: Coord,
  _fromDistrict?: District,
  _toDistrict?: District
): number {
  const manhattanDist = Math.abs(toCoord.x - fromCoord.x) + Math.abs(toCoord.y - fromCoord.y);

  if (tier === "ALONG") {
    // Flat commuter rate reflecting regulated Abuja route fares
    return Math.round(BASE_TRANSIT_FARE_KOBO * ALONG_FARE_MULTIPLIER);
  }

  // Bolt ride-hailing has a significantly higher fare multiplier (6.0x base = ₦3,000)
  // plus distance-based dynamic pricing for long hauls
  const distanceSurcharge = manhattanDist > 15 ? (manhattanDist - 15) * 2000 : 0;
  return Math.round(BASE_TRANSIT_FARE_KOBO * BOLT_FARE_MULTIPLIER + distanceSurcharge);
}

/**
 * Resolves a TRANSIT intent into a list of pure Effects.
 */
export function resolveTransit(
  world: WorldState,
  actor: ActorState,
  intent: TransitIntent,
  idemKey?: string
): Effect[] {
  const effectiveIdemKey = idemKey || `transit_${actor.id}_${Date.now()}`;

  // 1. Grid boundary and tile blocked validation
  if (!world.navGrid.inBounds(intent.toX, intent.toY)) {
    return [
      {
        kind: "ERROR",
        code: "INVALID_MOVE",
        message: `Transit destination (${intent.toX},${intent.toY}) is out of city bounds`,
      },
    ];
  }

  if (world.navGrid.isBlocked(intent.toX, intent.toY)) {
    return [
      {
        kind: "ERROR",
        code: "BLOCKED_TILE",
        message: `Transit drop-off point (${intent.toX},${intent.toY}) is impassable/blocked`,
      },
    ];
  }

  if (actor.position.x === intent.toX && actor.position.y === intent.toY) {
    return [
      {
        kind: "ERROR",
        code: "INVALID_MOVE",
        message: "Transit destination is the same as current position",
      },
    ];
  }

  // 2. Resolve origin and destination districts & zones
  const fromDistrict = world.navGrid.getDistrictAt(actor.position.x, actor.position.y)
    ?? (actor.home?.districtId ? world.navGrid.getDistrictById(actor.home.districtId) : undefined);

  let toDistrict = world.navGrid.getDistrictAt(intent.toX, intent.toY);
  if (!toDistrict && intent.toDistrictId) {
    toDistrict = world.navGrid.getDistrictById(intent.toDistrictId);
  }

  const destinationZone = world.navGrid.getZoneAt(intent.toX, intent.toY);

  // 3. Check Transit Availability
  const availability = isTransitAvailable(intent.tier, fromDistrict, toDistrict, actor);
  if (!availability.available) {
    return [
      {
        kind: "ERROR",
        code: "TRANSIT_UNAVAILABLE",
        message: availability.reason,
      },
    ];
  }

  // 4. Calculate fare
  const fareKobo = calculateTransitFare(
    intent.tier,
    actor.position,
    { x: intent.toX, y: intent.toY },
    fromDistrict,
    toDistrict
  );

  // 5. Balance check
  if (actor.balanceKobo < fareKobo) {
    return [
      {
        kind: "ERROR",
        code: "INSUFFICIENT_FUNDS",
        message: `Insufficient funds for ${intent.tier === "BOLT" ? "Bolt ride-hailing" : "Along commute"}: requires ₦${(fareKobo / 100).toFixed(2)}, balance is ₦${(actor.balanceKobo / 100).toFixed(2)}`,
      },
    ];
  }

  // 6. Energy / Fatigue check
  const energyDelta = intent.tier === "ALONG" ? ALONG_ENERGY_DELTA : BOLT_ENERGY_DELTA;
  if (intent.tier === "ALONG" && actor.energy < Math.abs(energyDelta)) {
    return [
      {
        kind: "ERROR",
        code: "INSUFFICIENT_ENERGY",
        message: "You are too exhausted to scramble and commute by Along. Rest or take a comfortable Bolt.",
      },
    ];
  }

  // 7. Social Capital adjustment
  let scDelta = 0;
  if (intent.tier === "BOLT") {
    const toId = toDistrict?.id?.toLowerCase() ?? "";
    if (HIGHBROW_DISTRICT_IDS.has(toId) || toDistrict?.tier === "core") {
      scDelta = BOLT_HIGHBROW_SC_BONUS;
    }
  }

  // 7.5 Calculate exact road path along Abuja road network
  const roadPath = world.navGrid.findRoadPath(
    actor.position,
    { x: intent.toX, y: intent.toY },
    { transitTier: intent.tier }
  );

  const destGeo = world.navGrid.gridToGeo({ x: intent.toX, y: intent.toY });

  // 8. Generate atomic effects
  const effects: Effect[] = [
    {
      kind: "CASH",
      deltaKobo: -fareKobo,
      idemKey: effectiveIdemKey,
      ledgerKind: "PURCHASE",
      relatedEntityId: intent.tier === "BOLT" ? "transit_bolt" : "transit_along",
    },
    {
      kind: "POSITION",
      toX: intent.toX,
      toY: intent.toY,
      enteredZoneId: destinationZone?.id ?? null,
      transitTier: intent.tier,
      pathWaypoints: roadPath?.waypoints,
      lat: destGeo.lat,
      lng: destGeo.lng,
    },
  ];

  if (energyDelta !== 0) {
    effects.push({
      kind: "ENERGY",
      delta: energyDelta,
    });
  }

  if (scDelta !== 0) {
    effects.push({
      kind: "SOCIAL_CAPITAL",
      delta: scDelta,
    });
  }

  return effects;
}
