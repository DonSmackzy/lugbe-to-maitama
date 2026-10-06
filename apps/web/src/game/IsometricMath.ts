// =============================================================================
// Isometric Math Utilities — apps/web/src/game/IsometricMath.ts
// Standard 2:1 Diamond Isometric Projection (Tile Width: 64px, Tile Height: 32px)
// =============================================================================

export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;
export const HALF_WIDTH = TILE_WIDTH / 2;   // 32
export const HALF_HEIGHT = TILE_HEIGHT / 2; // 16

// Origin offset so tile (0, 0) is well-positioned in world space
export const WORLD_ORIGIN_X = 3840; // 120 * 32
export const WORLD_ORIGIN_Y = 100;

/**
 * Converts discrete grid coordinates (gridX, gridY) to isometric 2D screen coordinates.
 */
export function gridToScreen(
  gridX: number,
  gridY: number
): { x: number; y: number } {
  const x = (gridX - gridY) * HALF_WIDTH + WORLD_ORIGIN_X;
  const y = (gridX + gridY) * HALF_HEIGHT + WORLD_ORIGIN_Y;
  return { x, y };
}

/**
 * Converts screen/world coordinates back to discrete grid coordinates.
 */
export function screenToGrid(
  screenX: number,
  screenY: number
): { gridX: number; gridY: number } {
  const relX = screenX - WORLD_ORIGIN_X;
  const relY = screenY - WORLD_ORIGIN_Y;

  const gridX = Math.round((relX / HALF_WIDTH + relY / HALF_HEIGHT) / 2);
  const gridY = Math.round((relY / HALF_HEIGHT - relX / HALF_WIDTH) / 2);

  return {
    gridX: Math.max(0, Math.min(119, gridX)),
    gridY: Math.max(0, Math.min(119, gridY)),
  };
}

/**
 * Strict Y-Sorting (Depth) calculation in isometric space.
 * Items positioned further down-screen (higher gridX + gridY) render in front.
 */
export function calculateDepth(gridX: number, gridY: number, layerBonus = 0): number {
  return gridX + gridY + layerBonus;
}
