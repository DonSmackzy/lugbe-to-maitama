// =============================================================================
// OSM Highway & GeoJSON Ingestion Parser — packages/engine/src/gis/osm-parser.ts
// Ingests real OpenStreetMap GeoJSON data for AMAC and satellite towns (Lugbe).
// Distinguishes Expressways, Arterials, Streets, and Closes with speeds & capacities.
// Pure logic. Zero I/O.
// =============================================================================

import type { Coord, GeoCoord } from "@ltm/city-schema";
import {
  geoToGridContinuous,
  calculateHaversineDistance,
  ABUJA_GEO_BOUNDS,
  DEFAULT_GRID_DIMENSIONS,
  type GeoBounds,
  type GridDimensions,
} from "./projection.js";

export type HighwayCategory = "expressway" | "arterial" | "street" | "close";

export interface HighwayCategorySpec {
  category: HighwayCategory;
  displayName: string;
  speedKmh: number;
  speedMultiplier: number;
  capacityPerLane: number;
  defaultLanes: number;
  renderColorHex: number;
  renderWidthPx: number;
}

export const HIGHWAY_SPECS: Record<HighwayCategory, HighwayCategorySpec> = {
  expressway: {
    category: "expressway",
    displayName: "Expressway / Highway (e.g., Airport Road)",
    speedKmh: 100,
    speedMultiplier: 3.0,
    capacityPerLane: 1000,
    defaultLanes: 3,
    renderColorHex: 0xf59e0b, // Amber / Orange
    renderWidthPx: 6,
  },
  arterial: {
    category: "arterial",
    displayName: "Arterial Road (e.g., Ahmadu Bello Way, Shehu Shagari)",
    speedKmh: 60,
    speedMultiplier: 2.0,
    capacityPerLane: 600,
    defaultLanes: 2,
    renderColorHex: 0x38bdf8, // Sky Blue / Cyan
    renderWidthPx: 4,
  },
  street: {
    category: "street",
    displayName: "Standard Urban Street (e.g., Gwarinpa 3rd Ave)",
    speedKmh: 40,
    speedMultiplier: 1.0,
    capacityPerLane: 300,
    defaultLanes: 1,
    renderColorHex: 0x94a3b8, // Slate
    renderWidthPx: 2,
  },
  close: {
    category: "close",
    displayName: "Close / Residential Lane / Service Road",
    speedKmh: 20,
    speedMultiplier: 0.5,
    capacityPerLane: 100,
    defaultLanes: 1,
    renderColorHex: 0x64748b, // Dark Slate
    renderWidthPx: 1.5,
  },
};

export interface RoadPoint {
  lat: number;
  lng: number;
  x: number; // Projected grid X
  y: number; // Projected grid Y
}

export interface ParsedRoadFeature {
  id: string;
  name: string;
  category: HighwayCategory;
  spec: HighwayCategorySpec;
  osmHighwayTag: string;
  lanes: number;
  oneWay: boolean;
  isRoundabout: boolean;
  points: RoadPoint[];
  lengthMeters: number;
}

export interface ParsedWaterBody {
  id: string;
  name: string;
  waterType: string;
  points: RoadPoint[];
}

export interface ParsedRoundabout {
  id: string;
  name: string;
  center: RoadPoint;
  perimeter: RoadPoint[];
  radiusMeters: number;
}

export interface ParsedGISData {
  roads: ParsedRoadFeature[];
  waterBodies: ParsedWaterBody[];
  roundabouts: ParsedRoundabout[];
  bounds: GeoBounds;
  dimensions: GridDimensions;
}

/**
 * Classifies an OSM highway tag into one of our 4 transit tiers.
 */
export function classifyHighwayTag(highwayTag: string | undefined): HighwayCategory | null {
  if (!highwayTag) return null;

  const normalized = highwayTag.trim().toLowerCase();

  switch (normalized) {
    case "motorway":
    case "motorway_link":
    case "trunk":
    case "trunk_link":
      return "expressway";

    case "primary":
    case "primary_link":
    case "secondary":
    case "secondary_link":
      return "arterial";

    case "tertiary":
    case "tertiary_link":
    case "residential":
    case "unclassified":
      return "street";

    case "living_street":
    case "service":
    case "pedestrian":
    case "track":
    case "footway":
      return "close";

    default:
      return null;
  }
}

/**
 * Checks whether an OSM feature indicates a one-way road.
 */
export function isOneWayHighway(properties: Record<string, unknown>): boolean {
  const oneway = String(properties.oneway ?? "").trim().toLowerCase();
  if (oneway === "yes" || oneway === "1" || oneway === "true") return true;
  if (properties.junction === "roundabout" || properties.junction === "circular") return true;
  return false;
}

/**
 * Parses raw GeoJSON FeatureCollection into typed, projected GIS data.
 */
export function parseOSMGeoJson(
  geojson: {
    type?: string;
    features?: Array<{
      type: string;
      id?: string | number;
      geometry: {
        type: string;
        coordinates: unknown;
      };
      properties?: Record<string, unknown>;
    }>;
  },
  bounds: GeoBounds = ABUJA_GEO_BOUNDS,
  dimensions: GridDimensions = DEFAULT_GRID_DIMENSIONS
): ParsedGISData {
  const roads: ParsedRoadFeature[] = [];
  const waterBodies: ParsedWaterBody[] = [];
  const roundabouts: ParsedRoundabout[] = [];

  const features = geojson.features ?? [];

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (!f) continue;

    const props = f.properties ?? {};
    const geom = f.geometry;

    if (!geom) continue;

    const featureId = String(f.id ?? props.id ?? `feat_${i}`);
    const name = String(props.name ?? props["name:en"] ?? "Unnamed");

    // 1. Water bodies (Polygons)
    const isWater =
      props.natural === "water" ||
      props.water === "lake" ||
      props.water === "reservoir" ||
      props.landuse === "reservoir";

    if (isWater && (geom.type === "Polygon" || geom.type === "MultiPolygon")) {
      const ringCoords = extractFirstPolygonRing(geom.type, geom.coordinates);
      if (ringCoords.length > 2) {
        const points = ringCoords.map(([lng, lat]) => {
          const grid = geoToGridContinuous({ lat, lng }, bounds, dimensions);
          return { lat, lng, x: grid.x, y: grid.y };
        });

        waterBodies.push({
          id: featureId,
          name: name.startsWith("Unnamed") ? "Jabi Lake" : name,
          waterType: String(props.water ?? "lake"),
          points,
        });
      }
      continue;
    }

    // 2. Highway roads (LineString / MultiLineString)
    const highwayTag = String(props.highway ?? "");
    const category = classifyHighwayTag(highwayTag);

    if (category && (geom.type === "LineString" || geom.type === "MultiLineString")) {
      const lineStrings =
        geom.type === "LineString"
          ? [geom.coordinates as [number, number][]]
          : (geom.coordinates as [number, number][][]);

      for (let lineIdx = 0; lineIdx < lineStrings.length; lineIdx++) {
        const rawCoords = lineStrings[lineIdx];
        if (!rawCoords || !Array.isArray(rawCoords) || rawCoords.length < 2) continue;

        let totalLengthMeters = 0;
        const points: RoadPoint[] = [];

        for (let ptIdx = 0; ptIdx < rawCoords.length; ptIdx++) {
          const coordPair = rawCoords[ptIdx];
          if (!coordPair) continue;
          const [lng, lat] = coordPair;
          const grid = geoToGridContinuous({ lat, lng }, bounds, dimensions);
          const pt: RoadPoint = { lat, lng, x: grid.x, y: grid.y };
          points.push(pt);

          if (ptIdx > 0) {
            const prev = points[ptIdx - 1];
            if (prev) {
              totalLengthMeters += calculateHaversineDistance(
                { lat: prev.lat, lng: prev.lng },
                { lat, lng }
              );
            }
          }
        }

        const isRoundabout =
          props.junction === "roundabout" ||
          props.junction === "circular" ||
          name.toLowerCase().includes("roundabout");

        const lanes =
          typeof props.lanes === "number"
            ? props.lanes
            : parseInt(String(props.lanes ?? ""), 10) ||
              HIGHWAY_SPECS[category].defaultLanes;

        const roadItem: ParsedRoadFeature = {
          id: `${featureId}_line_${lineIdx}`,
          name,
          category,
          spec: HIGHWAY_SPECS[category],
          osmHighwayTag: highwayTag,
          lanes,
          oneWay: isOneWayHighway(props),
          isRoundabout,
          points,
          lengthMeters: totalLengthMeters,
        };

        roads.push(roadItem);

        // Record roundabout specifically if detected
        if (isRoundabout && points.length >= 3) {
          const centerLat = points.reduce((acc, p) => acc + p.lat, 0) / points.length;
          const centerLng = points.reduce((acc, p) => acc + p.lng, 0) / points.length;
          const centerGrid = geoToGridContinuous(
            { lat: centerLat, lng: centerLng },
            bounds,
            dimensions
          );

          const radiusMeters =
            points.reduce(
              (acc, p) =>
                acc + calculateHaversineDistance({ lat: centerLat, lng: centerLng }, p),
              0
            ) / points.length;

          roundabouts.push({
            id: `rb_${featureId}`,
            name,
            center: {
              lat: centerLat,
              lng: centerLng,
              x: centerGrid.x,
              y: centerGrid.y,
            },
            perimeter: points,
            radiusMeters,
          });
        }
      }
    }
  }

  return {
    roads,
    waterBodies,
    roundabouts,
    bounds,
    dimensions,
  };
}

/**
 * Extracts outer ring coordinate pairs from Polygon or MultiPolygon coordinates.
 */
function extractFirstPolygonRing(type: string, coordinates: unknown): [number, number][] {
  if (!Array.isArray(coordinates)) return [];

  if (type === "Polygon") {
    const ring = coordinates[0];
    return Array.isArray(ring) ? (ring as [number, number][]) : [];
  }

  if (type === "MultiPolygon") {
    const firstPoly = coordinates[0];
    if (Array.isArray(firstPoly)) {
      const ring = firstPoly[0];
      return Array.isArray(ring) ? (ring as [number, number][]) : [];
    }
  }

  return [];
}
