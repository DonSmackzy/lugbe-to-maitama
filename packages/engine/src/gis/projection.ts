// =============================================================================
// GIS Coordinate Projection Utility — packages/engine/src/gis/projection.ts
// Converts real-world WGS84 Latitude/Longitude to 2.5D Isometric Cartesian Grid
// Pure logic. Zero I/O.
// =============================================================================

import type { Coord, GeoCoord } from "@ltm/city-schema";

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface GridDimensions {
  gridWidth: number;
  gridHeight: number;
}

/**
 * Standard WGS84 Bounding Box for Abuja Municipal Area Council (AMAC)
 * and Satellite towns (Lugbe corridor down to Airport Road south).
 *
 * Real-world coordinates:
 * - Lugbe (Airport Road South): Lat ~8.9500°N, Lng ~7.3700°E
 * - City Gate / National Stadium: Lat ~9.0340°N, Lng ~7.4420°E
 * - Garki / Area 1: Lat ~9.0265°N, Lng ~7.4720°E
 * - Berger Roundabout / Wuse: Lat ~9.0620°N, Lng ~7.4680°E
 * - Jabi Lake: Lat ~9.0780°N, Lng ~7.4260°E
 * - Gwarinpa: Lat ~9.1080°N, Lng ~7.4120°E
 * - Maitama / Aso Rock / AYA: Lat ~9.0880°N to 9.0560°N, Lng ~7.4980°E to ~7.5400°E
 */
export const ABUJA_GEO_BOUNDS: GeoBounds = {
  minLat: 8.9400,
  maxLat: 9.1500,
  minLng: 7.3400,
  maxLng: 7.5500,
};

export const DEFAULT_GRID_DIMENSIONS: GridDimensions = {
  gridWidth: 120,
  gridHeight: 120,
};

/**
 * Earth radius in meters for Haversine calculations
 */
const EARTH_RADIUS_METERS = 6371000;

/**
 * Projects WGS84 GeoCoord (lat, lng) to continuous Cartesian grid coordinates { x, y }.
 * In screen/grid coordinates, Y increases southwards (top to bottom),
 * while Latitude increases northwards.
 */
export function geoToGridContinuous(
  geo: GeoCoord,
  bounds: GeoBounds = ABUJA_GEO_BOUNDS,
  dimensions: GridDimensions = DEFAULT_GRID_DIMENSIONS
): { x: number; y: number } {
  const clampedLat = Math.max(bounds.minLat, Math.min(bounds.maxLat, geo.lat));
  const clampedLng = Math.max(bounds.minLng, Math.min(bounds.maxLng, geo.lng));

  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;

  const normX = lngSpan === 0 ? 0 : (clampedLng - bounds.minLng) / lngSpan;
  const normY = latSpan === 0 ? 0 : (bounds.maxLat - clampedLat) / latSpan;

  const x = normX * (dimensions.gridWidth - 1);
  const y = normY * (dimensions.gridHeight - 1);

  return { x, y };
}

/**
 * Projects WGS84 GeoCoord to discrete integer grid coordinates { x, y }.
 */
export function geoToGrid(
  geo: GeoCoord,
  bounds: GeoBounds = ABUJA_GEO_BOUNDS,
  dimensions: GridDimensions = DEFAULT_GRID_DIMENSIONS
): Coord {
  const continuous = geoToGridContinuous(geo, bounds, dimensions);
  return {
    x: Math.round(continuous.x),
    y: Math.round(continuous.y),
  };
}

/**
 * Inversely unprojects Cartesian grid coordinates { x, y } back to WGS84 GeoCoord.
 */
export function gridToGeo(
  grid: { x: number; y: number },
  bounds: GeoBounds = ABUJA_GEO_BOUNDS,
  dimensions: GridDimensions = DEFAULT_GRID_DIMENSIONS
): GeoCoord {
  const normX = Math.max(0, Math.min(1, grid.x / (dimensions.gridWidth - 1)));
  const normY = Math.max(0, Math.min(1, grid.y / (dimensions.gridHeight - 1)));

  const lng = bounds.minLng + normX * (bounds.maxLng - bounds.minLng);
  const lat = bounds.maxLat - normY * (bounds.maxLat - bounds.minLat);

  return { lat, lng };
}

/**
 * Great-circle distance between two geographic coordinates using Haversine formula (in meters).
 */
export function calculateHaversineDistance(c1: GeoCoord, c2: GeoCoord): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(c2.lat - c1.lat);
  const dLng = toRad(c2.lng - c1.lng);

  const lat1 = toRad(c1.lat);
  const lat2 = toRad(c2.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Converts discrete or continuous grid coordinates to 2:1 Diamond Isometric screen space.
 */
export function gridToIsometricScreen(
  gridX: number,
  gridY: number,
  tileWidth = 64,
  tileHeight = 32,
  originX = 3840,
  originY = 100
): { x: number; y: number } {
  const halfW = tileWidth / 2;
  const halfH = tileHeight / 2;
  const screenX = (gridX - gridY) * halfW + originX;
  const screenY = (gridX + gridY) * halfH + originY;
  return { x: screenX, y: screenY };
}

/**
 * Directly projects real-world GeoCoord to 2.5D Isometric screen space.
 */
export function geoToIsometricScreen(
  geo: GeoCoord,
  bounds: GeoBounds = ABUJA_GEO_BOUNDS,
  dimensions: GridDimensions = DEFAULT_GRID_DIMENSIONS,
  tileWidth = 64,
  tileHeight = 32,
  originX = 3840,
  originY = 100
): { x: number; y: number } {
  const grid = geoToGridContinuous(geo, bounds, dimensions);
  return gridToIsometricScreen(grid.x, grid.y, tileWidth, tileHeight, originX, originY);
}

/**
 * Interpolates waypoints between two grid coordinates for smooth path rendering.
 */
export function interpolateWaypoints(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  steps: number
): Array<{ x: number; y: number }> {
  if (steps <= 1) return [{ ...p1 }, { ...p2 }];

  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: p1.x + (p2.x - p1.x) * t,
      y: p1.y + (p2.y - p1.y) * t,
    });
  }
  return points;
}
