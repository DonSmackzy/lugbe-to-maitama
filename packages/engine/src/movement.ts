// =============================================================================
// MovementEngine — Validates player movement within city grid bounds.
// =============================================================================

import type { CityPack, Coord, Zone } from "@ltm/city-schema";

export type MoveResult =
  | { ok: true; newPosition: Coord; enteredZone: Zone | null }
  | { ok: false; reason: string };

export class MovementEngine {
  constructor(private readonly pack: CityPack) {}

  /**
   * Validate and process a move intent.
   * Returns the new position and the zone entered (if any).
   */
  move(from: Coord, to: Coord): MoveResult {
    if (!this.inBounds(to)) {
      return {
        ok: false,
        reason: `Target (${to.x},${to.y}) is out of city bounds (${this.pack.gridWidth}x${this.pack.gridHeight})`,
      };
    }

    const MAX_STEP = 1; // One tile per intent — prevents teleport cheats
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);

    if (dx > MAX_STEP || dy > MAX_STEP) {
      return {
        ok: false,
        reason: `Move step too large: (${dx},${dy}). Max step is ${MAX_STEP} per intent`,
      };
    }

    const enteredZone = this.zoneAt(to);

    return { ok: true, newPosition: to, enteredZone: enteredZone ?? null };
  }

  private inBounds(coord: Coord): boolean {
    return (
      coord.x >= 0 &&
      coord.y >= 0 &&
      coord.x < this.pack.gridWidth &&
      coord.y < this.pack.gridHeight
    );
  }

  private zoneAt(coord: Coord): Zone | undefined {
    return this.pack.zones.find(
      (z) =>
        coord.x >= z.bounds.topLeft.x &&
        coord.x <= z.bounds.bottomRight.x &&
        coord.y >= z.bounds.topLeft.y &&
        coord.y <= z.bounds.bottomRight.y
    );
  }
}
