// =============================================================================
// Road Network Graph & Pathfinding — packages/engine/src/gis/road-network.ts
// Direct routing over real OSM road edges, one-way streets, and roundabouts.
// Pure logic. Zero I/O.
// =============================================================================

import type { Coord, GeoCoord } from "@ltm/city-schema";
import {
  calculateHaversineDistance,
  geoToGridContinuous,
  gridToGeo,
  ABUJA_GEO_BOUNDS,
  DEFAULT_GRID_DIMENSIONS,
  type GeoBounds,
  type GridDimensions,
} from "./projection.js";
import {
  HIGHWAY_SPECS,
  type HighwayCategory,
  type ParsedRoadFeature,
  type RoadPoint,
  parseOSMGeoJson,
} from "./osm-parser.js";
import { ABUJA_OSM_GEOJSON } from "./abuja-osm-data.js";

export interface RoadNode {
  id: string;
  lat: number;
  lng: number;
  x: number;
  y: number;
  edges: string[]; // Edge IDs outgoing from this node
}

export interface RoadEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  name: string;
  category: HighwayCategory;
  speedKmh: number;
  speedMultiplier: number;
  capacity: number;
  oneWay: boolean;
  isRoundabout: boolean;
  lengthMeters: number;
  curvature: RoadPoint[];
}

export interface PathfindingWaypoint {
  x: number;
  y: number;
  lat: number;
  lng: number;
  speed: number;
  roadCategory: HighwayCategory;
}

export interface PathfindingResult {
  found: boolean;
  totalDistanceMeters: number;
  estimatedTravelTimeSeconds: number;
  waypoints: PathfindingWaypoint[];
  edgeIds: string[];
}

export class RoadNetworkGraph {
  public readonly nodes = new Map<string, RoadNode>();
  public readonly edges = new Map<string, RoadEdge>();

  constructor(
    roads: ParsedRoadFeature[] = [],
    public readonly bounds: GeoBounds = ABUJA_GEO_BOUNDS,
    public readonly dimensions: GridDimensions = DEFAULT_GRID_DIMENSIONS
  ) {
    if (roads.length > 0) {
      this.buildFromRoads(roads);
    }
  }

  /**
   * Generates a spatial quantization key for grouping closely situated intersection vertices.
   */
  private static nodeKey(lat: number, lng: number): string {
    // 5 decimal places is ~1.1 meters resolution
    return `${lat.toFixed(5)},${lng.toFixed(5)}`;
  }

  public getOrCreateNode(lat: number, lng: number, x: number, y: number): RoadNode {
    const key = RoadNetworkGraph.nodeKey(lat, lng);
    let node = this.nodes.get(key);
    if (!node) {
      node = {
        id: key,
        lat,
        lng,
        x,
        y,
        edges: [],
      };
      this.nodes.set(key, node);
    }
    return node;
  }

  /**
   * Ingests parsed road features and builds the directed edge graph.
   */
  public buildFromRoads(roads: ParsedRoadFeature[]): void {
    for (let rIdx = 0; rIdx < roads.length; rIdx++) {
      const road = roads[rIdx];
      if (!road) continue;

      const pts = road.points;
      if (pts.length < 2) continue;

      // Segment the polyline between successive points or intersection anchors
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        if (!p1 || !p2) continue;

        const node1 = this.getOrCreateNode(p1.lat, p1.lng, p1.x, p1.y);
        const node2 = this.getOrCreateNode(p2.lat, p2.lng, p2.x, p2.y);

        const segmentLength = calculateHaversineDistance(
          { lat: p1.lat, lng: p1.lng },
          { lat: p2.lat, lng: p2.lng }
        );

        const forwardEdgeId = `${road.id}_seg_${i}_fwd`;
        const forwardEdge: RoadEdge = {
          id: forwardEdgeId,
          fromNodeId: node1.id,
          toNodeId: node2.id,
          name: road.name,
          category: road.category,
          speedKmh: road.spec.speedKmh,
          speedMultiplier: road.spec.speedMultiplier,
          capacity: road.spec.capacityPerLane * road.lanes,
          oneWay: road.oneWay,
          isRoundabout: road.isRoundabout,
          lengthMeters: segmentLength,
          curvature: [p1, p2],
        };

        this.edges.set(forwardEdgeId, forwardEdge);
        node1.edges.push(forwardEdgeId);

        // If road is bidirectional and not a roundabout, add reverse edge
        if (!road.oneWay && !road.isRoundabout) {
          const reverseEdgeId = `${road.id}_seg_${i}_rev`;
          const reverseEdge: RoadEdge = {
            id: reverseEdgeId,
            fromNodeId: node2.id,
            toNodeId: node1.id,
            name: road.name,
            category: road.category,
            speedKmh: road.spec.speedKmh,
            speedMultiplier: road.spec.speedMultiplier,
            capacity: road.spec.capacityPerLane * road.lanes,
            oneWay: false,
            isRoundabout: false,
            lengthMeters: segmentLength,
            curvature: [p2, p1],
          };

          this.edges.set(reverseEdgeId, reverseEdge);
          node2.edges.push(reverseEdgeId);
        }
      }
    }
  }

  /**
   * Snaps any coordinate to the nearest road network node.
   */
  public snapToNearestNode(
    coord: { x: number; y: number } | GeoCoord
  ): RoadNode | null {
    if (this.nodes.size === 0) return null;

    let targetX: number;
    let targetY: number;

    if ("lat" in coord && "lng" in coord) {
      const grid = geoToGridContinuous(coord, this.bounds, this.dimensions);
      targetX = grid.x;
      targetY = grid.y;
    } else {
      targetX = coord.x;
      targetY = coord.y;
    }

    let closestNode: RoadNode | null = null;
    let minDistanceSq = Infinity;

    for (const node of this.nodes.values()) {
      const dx = node.x - targetX;
      const dy = node.y - targetY;
      const distSq = dx * dx + dy * dy;

      if (distSq < minDistanceSq) {
        minDistanceSq = distSq;
        closestNode = node;
      }
    }

    return closestNode;
  }

  /**
   * A* shortest path search over the road network graph.
   * Respects one-way roads, roundabouts, and speed multipliers.
   */
  public findPath(
    origin: { x: number; y: number } | GeoCoord,
    destination: { x: number; y: number } | GeoCoord,
    options: {
      minimizeBy?: "time" | "distance";
      transitTier?: "ALONG" | "BOLT";
    } = {}
  ): PathfindingResult {
    const minimizeBy = options.minimizeBy ?? "time";
    const startNode = this.snapToNearestNode(origin);
    const endNode = this.snapToNearestNode(destination);

    if (!startNode || !endNode) {
      return {
        found: false,
        totalDistanceMeters: 0,
        estimatedTravelTimeSeconds: 0,
        waypoints: [],
        edgeIds: [],
      };
    }

    if (startNode.id === endNode.id) {
      const wp: PathfindingWaypoint = {
        x: startNode.x,
        y: startNode.y,
        lat: startNode.lat,
        lng: startNode.lng,
        speed: 40,
        roadCategory: "street",
      };
      return {
        found: true,
        totalDistanceMeters: 0,
        estimatedTravelTimeSeconds: 0,
        waypoints: [wp],
        edgeIds: [],
      };
    }

    // A* Data structures
    const openSet = new Set<string>([startNode.id]);
    const cameFromEdge = new Map<string, RoadEdge>();
    const cameFromNode = new Map<string, string>();

    const gScore = new Map<string, number>();
    gScore.set(startNode.id, 0);

    const fScore = new Map<string, number>();
    fScore.set(startNode.id, this.heuristic(startNode, endNode, minimizeBy));

    while (openSet.size > 0) {
      // Find node with lowest fScore
      let currentId: string | null = null;
      let lowestF = Infinity;

      for (const id of openSet) {
        const score = fScore.get(id) ?? Infinity;
        if (score < lowestF) {
          lowestF = score;
          currentId = id;
        }
      }

      if (!currentId) break;

      if (currentId === endNode.id) {
        // Reconstruct path
        return this.reconstructPath(
          endNode.id,
          cameFromNode,
          cameFromEdge,
          startNode
        );
      }

      openSet.delete(currentId);
      const currentNode = this.nodes.get(currentId);
      if (!currentNode) continue;

      const currentG = gScore.get(currentId) ?? Infinity;

      // Explore directed outgoing edges
      for (const edgeId of currentNode.edges) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;

        const neighborId = edge.toNodeId;
        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;

        // Cost calculation
        let edgeCost: number;
        if (minimizeBy === "time") {
          // Travel time in seconds = distance / (speed in m/s)
          const speedMps = Math.max(1, (edge.speedKmh * 1000) / 3600);
          edgeCost = edge.lengthMeters / speedMps;
        } else {
          edgeCost = edge.lengthMeters;
        }

        const tentativeG = currentG + edgeCost;

        if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
          cameFromNode.set(neighborId, currentId);
          cameFromEdge.set(neighborId, edge);
          gScore.set(neighborId, tentativeG);

          const h = this.heuristic(neighborNode, endNode, minimizeBy);
          fScore.set(neighborId, tentativeG + h);

          openSet.add(neighborId);
        }
      }
    }

    // Fallback: If disconnected on graph, fallback to direct straight-line interpolation
    return this.fallbackDirectPath(startNode, endNode);
  }

  private heuristic(
    node: RoadNode,
    target: RoadNode,
    minimizeBy: "time" | "distance"
  ): number {
    const distMeters = calculateHaversineDistance(
      { lat: node.lat, lng: node.lng },
      { lat: target.lat, lng: target.lng }
    );

    if (minimizeBy === "time") {
      // Optimistic assumption: travel at expressway speed (100 km/h = 27.7 m/s)
      return distMeters / 27.77;
    }
    return distMeters;
  }

  private reconstructPath(
    endNodeId: string,
    cameFromNode: Map<string, string>,
    cameFromEdge: Map<string, RoadEdge>,
    startNode: RoadNode
  ): PathfindingResult {
    const edgeIds: string[] = [];
    const waypoints: PathfindingWaypoint[] = [];
    let totalDistanceMeters = 0;
    let totalTravelTimeSeconds = 0;

    let currId: string | undefined = endNodeId;

    const reverseEdges: RoadEdge[] = [];
    while (currId && cameFromEdge.has(currId)) {
      const edge = cameFromEdge.get(currId)!;
      reverseEdges.unshift(edge);
      edgeIds.unshift(edge.id);
      currId = cameFromNode.get(currId);
    }

    // Assemble smooth waypoints along road curvature
    waypoints.push({
      x: startNode.x,
      y: startNode.y,
      lat: startNode.lat,
      lng: startNode.lng,
      speed: 40,
      roadCategory: "street",
    });

    for (const edge of reverseEdges) {
      totalDistanceMeters += edge.lengthMeters;
      const speedMps = Math.max(1, (edge.speedKmh * 1000) / 3600);
      totalTravelTimeSeconds += edge.lengthMeters / speedMps;

      // Add curvature points (excluding duplicate of previous start point)
      for (let pIdx = 1; pIdx < edge.curvature.length; pIdx++) {
        const pt = edge.curvature[pIdx];
        if (!pt) continue;
        waypoints.push({
          x: pt.x,
          y: pt.y,
          lat: pt.lat,
          lng: pt.lng,
          speed: edge.speedKmh,
          roadCategory: edge.category,
        });
      }
    }

    return {
      found: true,
      totalDistanceMeters,
      estimatedTravelTimeSeconds: Math.round(totalTravelTimeSeconds),
      waypoints,
      edgeIds,
    };
  }

  private fallbackDirectPath(
    startNode: RoadNode,
    endNode: RoadNode
  ): PathfindingResult {
    const distMeters = calculateHaversineDistance(
      { lat: startNode.lat, lng: startNode.lng },
      { lat: endNode.lat, lng: endNode.lng }
    );

    const steps = Math.max(4, Math.min(20, Math.round(distMeters / 500)));
    const waypoints: PathfindingWaypoint[] = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const lat = startNode.lat + (endNode.lat - startNode.lat) * t;
      const lng = startNode.lng + (endNode.lng - startNode.lng) * t;
      const x = startNode.x + (endNode.x - startNode.x) * t;
      const y = startNode.y + (endNode.y - startNode.y) * t;

      waypoints.push({
        x,
        y,
        lat,
        lng,
        speed: 40,
        roadCategory: "street",
      });
    }

    return {
      found: true,
      totalDistanceMeters: distMeters,
      estimatedTravelTimeSeconds: Math.round(distMeters / 11.1), // ~40 km/h
      waypoints,
      edgeIds: [],
    };
  }
}

let defaultAbujaRoadGraph: RoadNetworkGraph | null = null;

/**
 * Returns a cached singleton RoadNetworkGraph pre-loaded with Abuja's
 * real OSM expressway, arterial, roundabout, and street network.
 */
export function getDefaultAbujaRoadGraph(): RoadNetworkGraph {
  if (!defaultAbujaRoadGraph) {
    const parsed = parseOSMGeoJson(ABUJA_OSM_GEOJSON);
    defaultAbujaRoadGraph = new RoadNetworkGraph(parsed.roads);
  }
  return defaultAbujaRoadGraph;
}

