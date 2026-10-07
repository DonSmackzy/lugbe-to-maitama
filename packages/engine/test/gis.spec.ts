import { describe, it, expect } from "vitest";
import {
  geoToGrid,
  gridToGeo,
  geoToGridContinuous,
  calculateHaversineDistance,
  ABUJA_GEO_BOUNDS,
  classifyHighwayTag,
  HIGHWAY_SPECS,
  parseOSMGeoJson,
  RoadNetworkGraph,
  getDefaultAbujaRoadGraph,
  ABUJA_OSM_GEOJSON,
  ABUJA_CULTURE_OVERLAY,
  getCulturePOIById,
  getCulturePOIsByDistrict,
  NavGrid,
  resolveTransit,
  type WorldState,
  type ActorState,
} from "../src/index.js";

describe("GIS Ingestion & Mapping Architecture (@ltm/engine)", () => {
  describe("1. Coordinate Projection Utility (WGS84 <-> 2.5D Cartesian Grid)", () => {
    it("should project real-world Abuja bounds correctly into grid dimensions", () => {
      // Southernmost & Westernmost: Lugbe area (~8.9400, ~7.3400)
      const southwest = geoToGrid({ lat: ABUJA_GEO_BOUNDS.minLat, lng: ABUJA_GEO_BOUNDS.minLng });
      expect(southwest.x).toBe(0);
      expect(southwest.y).toBe(119); // Y increases southwards

      // Northernmost & Easternmost: Northeast corner (~9.1500, ~7.5500)
      const northeast = geoToGrid({ lat: ABUJA_GEO_BOUNDS.maxLat, lng: ABUJA_GEO_BOUNDS.maxLng });
      expect(northeast.x).toBe(119);
      expect(northeast.y).toBe(0);
    });

    it("should project Berger Roundabout and City Gate into expected grid zones", () => {
      // Berger Roundabout: Lat 9.0620, Lng 7.4680
      const bergerGrid = geoToGrid({ lat: 9.0620, lng: 7.4680 });
      expect(bergerGrid.x).toBeGreaterThan(60);
      expect(bergerGrid.x).toBeLessThan(80);
      expect(bergerGrid.y).toBeGreaterThan(40);
      expect(bergerGrid.y).toBeLessThan(60);

      // Invert back to geo
      const unprojected = gridToGeo(bergerGrid);
      expect(unprojected.lat).toBeCloseTo(9.0620, 1);
      expect(unprojected.lng).toBeCloseTo(7.4680, 1);
    });

    it("should calculate realistic Haversine distance between Lugbe and City Gate", () => {
      const lugbeGeo = { lat: 8.9650, lng: 7.3680 }; // Lugbe FHA
      const cityGateGeo = { lat: 9.0340, lng: 7.4420 }; // City Gate
      const distanceMeters = calculateHaversineDistance(lugbeGeo, cityGateGeo);

      // Airport Road commute distance is approximately 11-13 km
      expect(distanceMeters).toBeGreaterThan(10000);
      expect(distanceMeters).toBeLessThan(14000);
    });
  });

  describe("2. OSM Highway Tag Parser & Hierarchy", () => {
    it("should classify highway tags into 4 distinct speed/capacity tiers", () => {
      // Expressways
      expect(classifyHighwayTag("motorway")).toBe("expressway");
      expect(classifyHighwayTag("trunk")).toBe("expressway");
      expect(HIGHWAY_SPECS.expressway.speedKmh).toBe(100);
      expect(HIGHWAY_SPECS.expressway.speedMultiplier).toBe(3.0);
      expect(HIGHWAY_SPECS.expressway.capacityPerLane).toBe(1000);

      // Arterials
      expect(classifyHighwayTag("primary")).toBe("arterial");
      expect(classifyHighwayTag("secondary")).toBe("arterial");
      expect(HIGHWAY_SPECS.arterial.speedKmh).toBe(60);
      expect(HIGHWAY_SPECS.arterial.speedMultiplier).toBe(2.0);

      // Streets
      expect(classifyHighwayTag("tertiary")).toBe("street");
      expect(classifyHighwayTag("residential")).toBe("street");
      expect(HIGHWAY_SPECS.street.speedKmh).toBe(40);
      expect(HIGHWAY_SPECS.street.speedMultiplier).toBe(1.0);

      // Closes
      expect(classifyHighwayTag("service")).toBe("close");
      expect(classifyHighwayTag("living_street")).toBe("close");
      expect(HIGHWAY_SPECS.close.speedKmh).toBe(20);
      expect(HIGHWAY_SPECS.close.speedMultiplier).toBe(0.5);
    });

    it("should parse authentic Abuja GeoJSON and identify roads, water, and roundabouts", () => {
      const parsed = parseOSMGeoJson(ABUJA_OSM_GEOJSON);

      // Water body check: Jabi Lake
      const jabiLake = parsed.waterBodies.find((w) => w.name.includes("Jabi Lake"));
      expect(jabiLake).toBeDefined();
      expect(jabiLake!.points.length).toBeGreaterThan(3);

      // Roundabouts check: Berger Roundabout & AYA Roundabout
      const bergerRb = parsed.roundabouts.find((r) => r.name.includes("Berger"));
      expect(bergerRb).toBeDefined();
      expect(bergerRb!.perimeter.length).toBeGreaterThan(3);

      const ayaRb = parsed.roundabouts.find((r) => r.name.includes("AYA"));
      expect(ayaRb).toBeDefined();

      // Expressways: Airport Road
      const airportRoad = parsed.roads.find((r) => r.name.includes("Airport Road"));
      expect(airportRoad).toBeDefined();
      expect(airportRoad!.category).toBe("expressway");
      expect(airportRoad!.oneWay).toBe(true);
    });
  });

  describe("3. Culture POI Overlay System", () => {
    it("should contain all required hyper-local Abuja cultural joints", () => {
      expect(ABUJA_CULTURE_OVERLAY.pois.length).toBeGreaterThanOrEqual(4);

      const suya = getCulturePOIById("area_1_suya_spot");
      expect(suya).toBeDefined();
      expect(suya!.displayName).toBe("Area 1 Suya Spot");
      expect(suya!.category).toBe("food_and_nightlife");
      expect(suya!.culturalPerk?.energyDelta).toBe(35);

      const berger = getCulturePOIById("berger_underbridge");
      expect(berger).toBeDefined();
      expect(berger!.category).toBe("transit_hub");
      expect(berger!.culturalPerk?.type).toBe("ALONG_TRANSIT_DISCOUNT");

      const gwarinpa = getCulturePOIById("gwarinpa_3rd_avenue");
      expect(gwarinpa).toBeDefined();
      expect(gwarinpa!.category).toBe("commercial_strip");
      expect(gwarinpa!.culturalPerk?.socialCapitalDelta).toBe(20);

      const bdc = getCulturePOIById("zone_4_bdc_hub");
      expect(bdc).toBeDefined();
      expect(bdc!.category).toBe("financial_blackmarket");
      expect(bdc!.culturalPerk?.cashMultiplier).toBe(1.15);
    });

    it("should query POIs by district", () => {
      const wusePois = getCulturePOIsByDistrict("wuse");
      expect(wusePois.some((p) => p.id === "berger_underbridge")).toBe(true);
      expect(wusePois.some((p) => p.id === "zone_4_bdc_hub")).toBe(true);
    });
  });

  describe("4. Road Network Graph & Real Curvature Pathfinding", () => {
    it("should compute route snapping and follow real road curves between Lugbe and City Gate", () => {
      const graph = getDefaultAbujaRoadGraph();
      expect(graph.nodes.size).toBeGreaterThan(10);
      expect(graph.edges.size).toBeGreaterThan(10);

      // Start at Lugbe FHA (around grid coord ~16, ~105)
      const lugbeCoord = geoToGrid({ lat: 8.9650, lng: 7.3680 });
      // End at Berger Roundabout (around grid coord ~73, ~50)
      const bergerCoord = geoToGrid({ lat: 9.0620, lng: 7.4680 });

      const path = graph.findPath(lugbeCoord, bergerCoord, { transitTier: "ALONG" });
      expect(path.found).toBe(true);
      expect(path.totalDistanceMeters).toBeGreaterThan(5000);
      expect(path.waypoints.length).toBeGreaterThan(3);

      // Waypoints must contain spatial lat/lng and projected x/y
      const firstWp = path.waypoints[0]!;
      expect(firstWp.lat).toBeDefined();
      expect(firstWp.lng).toBeDefined();
      expect(firstWp.x).toBeDefined();
      expect(firstWp.y).toBeDefined();
    });

    it("should generate path waypoints in NavGrid and transit resolution", () => {
      const navGrid = new NavGrid(120, 120);
      const start = { x: 10, y: 100 }; // Lugbe region
      const end = { x: 75, y: 50 }; // Midtown / Wuse region

      const roadPath = navGrid.findRoadPath(start, end, { transitTier: "BOLT" });
      expect(roadPath).toBeDefined();
      expect(roadPath.found).toBe(true);
      expect(roadPath.waypoints.length).toBeGreaterThan(0);
    });
  });
});
