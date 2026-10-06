// =============================================================================
// NavGrid — Navigation grid with blocked tiles and spatial zoning.
// Pure logic. Zero I/O.
// =============================================================================

import type { Coord, Zone } from "@ltm/city-schema";
import type { ErrorCode } from "./effects.js";

export type DistrictTier = "satellite" | "midtown" | "core" | "restricted" | "apex";

export type DistrictEntryRequirements = {
  minSocialCapital?: number;
  requiredItem?: string;
  allowedAppearanceTag?: string;
};

export type District = {
  id: string;
  displayName: string;
  tier: DistrictTier;
  zoneIds: string[];
  blockedTiles: Coord[];
  entryRequirements?: DistrictEntryRequirements;
};

export type NavValidationResult =
  | { ok: true; enteredZoneId: string | null; enteredDistrictId: string | null }
  | { ok: false; code: ErrorCode; reason: string };

export class NavGrid {
  private readonly blockedSet = new Set<string>();
  private readonly zoneList: Zone[];
  private readonly districtList: District[];
  private readonly zoneToDistrictMap = new Map<string, District>();

  constructor(
    public readonly width: number,
    public readonly height: number,
    zones: Zone[] = [],
    districts: District[] = []
  ) {
    this.zoneList = zones;
    this.districtList = districts;

    // Index districts by zone
    for (const district of districts) {
      for (const zoneId of district.zoneIds) {
        this.zoneToDistrictMap.set(zoneId, district);
      }
      for (const tile of district.blockedTiles) {
        this.blockTile(tile.x, tile.y);
      }
    }
  }

  static key(x: number, y: number): string {
    return `${x},${y}`;
  }

  blockTile(x: number, y: number): void {
    this.blockedSet.add(NavGrid.key(x, y));
  }

  unblockTile(x: number, y: number): void {
    this.blockedSet.delete(NavGrid.key(x, y));
  }

  isBlocked(x: number, y: number): boolean {
    return this.blockedSet.has(NavGrid.key(x, y));
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  getZoneAt(x: number, y: number): Zone | undefined {
    return this.zoneList.find(
      (z) =>
        x >= z.bounds.topLeft.x &&
        x <= z.bounds.bottomRight.x &&
        y >= z.bounds.topLeft.y &&
        y <= z.bounds.bottomRight.y
    );
  }

  getDistrictAt(x: number, y: number): District | undefined {
    const zone = this.getZoneAt(x, y);
    if (!zone) return undefined;
    return this.zoneToDistrictMap.get(zone.id);
  }

  getDistrictById(districtId: string): District | undefined {
    return this.districtList.find((d) => d.id === districtId);
  }

  validateMove(from: Coord, to: Coord): NavValidationResult {
    if (!this.inBounds(to.x, to.y)) {
      return {
        ok: false,
        code: "INVALID_MOVE",
        reason: `Target (${to.x},${to.y}) is out of grid bounds (${this.width}x${this.height})`,
      };
    }

    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);

    if (dx === 0 && dy === 0) {
      return {
        ok: false,
        code: "INVALID_MOVE",
        reason: "Target is same as origin",
      };
    }

    if (dx > 1 || dy > 1) {
      return {
        ok: false,
        code: "INVALID_MOVE",
        reason: `Move step too large (${dx},${dy}). Max step is 1 tile per intent`,
      };
    }

    if (this.isBlocked(to.x, to.y)) {
      return {
        ok: false,
        code: "BLOCKED_TILE",
        reason: `Tile (${to.x},${to.y}) is impassable/blocked`,
      };
    }

    const zone = this.getZoneAt(to.x, to.y);
    const district = zone ? this.zoneToDistrictMap.get(zone.id) : undefined;

    return {
      ok: true,
      enteredZoneId: zone?.id ?? null,
      enteredDistrictId: district?.id ?? null,
    };
  }
}
