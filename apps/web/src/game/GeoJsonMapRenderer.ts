// =============================================================================
// WebGL Map-Aware Real-World GIS Renderer — apps/web/src/game/GeoJsonMapRenderer.ts
// Renders real OSM polygon geometry: Jabi Lake, Airport Road, Berger Roundabout,
// AYA Roundabout, and Cultural POIs onto Phaser 3's 2.5D Isometric WebGL plane.
// =============================================================================

import Phaser from "phaser";
import { gridToScreen, calculateDepth } from "./IsometricMath.js";
import {
  parseOSMGeoJson,
  ABUJA_OSM_GEOJSON,
  ABUJA_CULTURE_OVERLAY,
  type ParsedGISData,
  type ParsedRoadFeature,
  type ParsedWaterBody,
  type ParsedRoundabout,
  type PathfindingWaypoint,
} from "@ltm/engine";
import type { CulturePOI } from "@ltm/city-schema";

export interface GeoJsonMapRendererConfig {
  scene: Phaser.Scene;
  gisData?: ParsedGISData;
  cultureOverlay?: typeof ABUJA_CULTURE_OVERLAY;
  onPOIClick?: (poi: CulturePOI) => void;
}

export class GeoJsonMapRenderer {
  private readonly scene: Phaser.Scene;
  private readonly gisData: ParsedGISData;
  private readonly cultureOverlay: typeof ABUJA_CULTURE_OVERLAY;
  private readonly onPOIClick: ((poi: CulturePOI) => void) | undefined;

  // Graphics layers
  private waterGraphics!: Phaser.GameObjects.Graphics;
  private roadBaseGraphics!: Phaser.GameObjects.Graphics;
  private roadMarkingGraphics!: Phaser.GameObjects.Graphics;
  private roundaboutGraphics!: Phaser.GameObjects.Graphics;
  private poiContainer!: Phaser.GameObjects.Container;
  private transitVehicleContainer!: Phaser.GameObjects.Container;

  // Animation tickers
  private waveAnimationOffset = 0;

  constructor(config: GeoJsonMapRendererConfig) {
    this.scene = config.scene;
    this.gisData = config.gisData ?? parseOSMGeoJson(ABUJA_OSM_GEOJSON);
    this.cultureOverlay = config.cultureOverlay ?? ABUJA_CULTURE_OVERLAY;
    this.onPOIClick = config.onPOIClick;

    this.createLayers();
  }

  private createLayers(): void {
    // 1. Water layer (rendered below roads)
    this.waterGraphics = this.scene.add.graphics();
    this.waterGraphics.setDepth(1);

    // 2. Road asphalt base layer
    this.roadBaseGraphics = this.scene.add.graphics();
    this.roadBaseGraphics.setDepth(2);

    // 3. Road markings & centerline glow layer
    this.roadMarkingGraphics = this.scene.add.graphics();
    this.roadMarkingGraphics.setDepth(3);

    // 4. Roundabout structures
    this.roundaboutGraphics = this.scene.add.graphics();
    this.roundaboutGraphics.setDepth(4);

    // 5. Culture POI overlays & interactive pins
    this.poiContainer = this.scene.add.container(0, 0);
    this.poiContainer.setDepth(10);

    // 6. Active transit vehicles
    this.transitVehicleContainer = this.scene.add.container(0, 0);
    this.transitVehicleContainer.setDepth(15);

    // Render all real-world geometry
    this.renderWaterBodies();
    this.renderRoadNetwork();
    this.renderRoundabouts();
    this.renderCulturePOIs();
  }

  /**
   * Renders real natural water bodies (Jabi Lake) directly from GeoJSON polygon coordinates.
   */
  public renderWaterBodies(): void {
    this.waterGraphics.clear();

    for (const water of this.gisData.waterBodies) {
      if (water.points.length < 3) continue;

      const screenPoints: Phaser.Geom.Point[] = water.points.map((pt: { x: number; y: number }) => {
        const scr = gridToScreen(pt.x, pt.y);
        return new Phaser.Geom.Point(scr.x, scr.y);
      });

      // Filled water polygon (WebGL tessellation)
      this.waterGraphics.fillStyle(0x0284c7, 0.75); // Deep azure blue
      this.waterGraphics.fillPoints(screenPoints, true);

      // Inner lake highlight
      this.waterGraphics.lineStyle(3, 0x38bdf8, 0.9); // Cyan shoreline
      this.waterGraphics.strokePoints(screenPoints, true);

      // Label at lake center
      const centerScreen = gridToScreen(
        water.points.reduce((a: number, b: { x: number }) => a + b.x, 0) / water.points.length,
        water.points.reduce((a: number, b: { y: number }) => a + b.y, 0) / water.points.length
      );

      const label = this.scene.add.text(
        centerScreen.x,
        centerScreen.y - 10,
        `🌊 ${water.name.toUpperCase()}`,
        {
          fontSize: "13px",
          fontFamily: "'Segoe UI', Arial, sans-serif",
          fontStyle: "bold",
          color: "#e0f2fe",
          backgroundColor: "rgba(3, 105, 161, 0.8)",
          padding: { x: 6, y: 3 },
        }
      );
      label.setOrigin(0.5);
      label.setDepth(5);
    }
  }

  /**
   * Renders the road network polylines (Expressways, Arterials, Streets, Closes)
   * following real street curvature.
   */
  public renderRoadNetwork(): void {
    this.roadBaseGraphics.clear();
    this.roadMarkingGraphics.clear();

    for (const road of this.gisData.roads) {
      if (road.points.length < 2) continue;

      const screenCoords = road.points.map((pt: { x: number; y: number }) => gridToScreen(pt.x, pt.y));

      // Determine road line width and asphalt tone
      let baseWidth = 8;
      let centerColor = road.spec.renderColorHex;
      let centerWidth = 2;

      if (road.category === "expressway") {
        baseWidth = 14;
        centerWidth = 3;
      } else if (road.category === "arterial") {
        baseWidth = 10;
        centerWidth = 2;
      } else if (road.category === "street") {
        baseWidth = 6;
        centerWidth = 1.5;
      } else {
        baseWidth = 4;
        centerWidth = 1;
      }

      // 1. Draw asphalt base
      this.roadBaseGraphics.lineStyle(baseWidth, 0x1e293b, 0.95); // Dark slate asphalt
      this.roadBaseGraphics.beginPath();
      this.roadBaseGraphics.moveTo(screenCoords[0]!.x, screenCoords[0]!.y);
      for (let i = 1; i < screenCoords.length; i++) {
        this.roadBaseGraphics.lineTo(screenCoords[i]!.x, screenCoords[i]!.y);
      }
      this.roadBaseGraphics.strokePath();

      // 2. Draw road center line & highway category indicator
      this.roadMarkingGraphics.lineStyle(centerWidth, centerColor, 0.85);
      this.roadMarkingGraphics.beginPath();
      this.roadMarkingGraphics.moveTo(screenCoords[0]!.x, screenCoords[0]!.y);
      for (let i = 1; i < screenCoords.length; i++) {
        this.roadMarkingGraphics.lineTo(screenCoords[i]!.x, screenCoords[i]!.y);
      }
      this.roadMarkingGraphics.strokePath();

      // 3. One-way direction arrows on expressways & arterials
      if (road.oneWay && screenCoords.length >= 3) {
        const midIdx = Math.floor(screenCoords.length / 2);
        const pA = screenCoords[midIdx - 1]!;
        const pB = screenCoords[midIdx]!;
        const angle = Phaser.Math.Angle.Between(pA.x, pA.y, pB.x, pB.y);

        this.roadMarkingGraphics.fillStyle(centerColor, 0.9);
        this.roadMarkingGraphics.fillCircle(pB.x, pB.y, centerWidth * 1.5);
      }
    }
  }

  /**
   * Renders roundabouts (e.g. Berger Roundabout, AYA Roundabout)
   * with circular traffic loops and landscaped central island.
   */
  public renderRoundabouts(): void {
    this.roundaboutGraphics.clear();

    for (const rb of this.gisData.roundabouts) {
      const centerScr = gridToScreen(rb.center.x, rb.center.y);

      // Central landscaped island
      this.roundaboutGraphics.fillStyle(0x15803d, 0.9); // Lush grass green
      this.roundaboutGraphics.fillCircle(centerScr.x, centerScr.y, 22);

      // Circular asphalt ring
      this.roundaboutGraphics.lineStyle(8, 0x1e293b, 0.95);
      this.roundaboutGraphics.strokeCircle(centerScr.x, centerScr.y, 26);

      // Glowing golden outer traffic guide
      this.roundaboutGraphics.lineStyle(2, 0xf59e0b, 0.9);
      this.roundaboutGraphics.strokeCircle(centerScr.x, centerScr.y, 28);

      // Landmark label
      const tagText = rb.name.includes("Berger")
        ? "BERGER ROUNDABOUT (Along Hub)"
        : rb.name.includes("AYA")
          ? "AYA ROUNDABOUT (Asokoro)"
          : rb.name.toUpperCase();

      const rbLabel = this.scene.add.text(centerScr.x, centerScr.y - 36, `🔄 ${tagText}`, {
        fontSize: "12px",
        fontFamily: "'Segoe UI', Arial, sans-serif",
        fontStyle: "bold",
        color: "#fef08a",
        backgroundColor: "rgba(15, 23, 42, 0.85)",
        padding: { x: 5, y: 3 },
      });
      rbLabel.setOrigin(0.5);
      rbLabel.setDepth(6);
    }
  }

  /**
   * Pins hyper-local street culture POIs:
   * 'Area 1 Suya Spot', 'Berger Underbridge (Along Park)', 'Gwarinpa 3rd Avenue', 'Zone 4 BDC Hub'
   */
  public renderCulturePOIs(): void {
    this.poiContainer.removeAll(true);

    for (const poi of this.cultureOverlay.pois) {
      const grid = poi.gridCoord ?? { x: 60, y: 60 };
      const scr = gridToScreen(grid.x, grid.y);

      const marker = this.createPOIMarker(poi, scr.x, scr.y);
      this.poiContainer.add(marker);
    }
  }

  private createPOIMarker(
    poi: CulturePOI,
    screenX: number,
    screenY: number
  ): Phaser.GameObjects.Container {
    const container = this.scene.add.container(screenX, screenY);

    // Color theme by category
    let pinColor = 0xef4444; // Red default
    let icon = "📍";

    switch (poi.category) {
      case "food_and_nightlife":
        pinColor = 0xf97316; // Orange flame
        icon = "🥩";
        break;
      case "transit_hub":
        pinColor = 0x10b981; // Emerald green
        icon = "🚐";
        break;
      case "commercial_strip":
        pinColor = 0x8b5cf6; // Purple
        icon = "🛍️";
        break;
      case "financial_blackmarket":
        pinColor = 0xeab308; // Gold
        icon = "💵";
        break;
    }

    // Glowing halo pulse
    const halo = this.scene.add.circle(0, 0, 16, pinColor, 0.25);
    this.scene.tweens.add({
      targets: halo,
      scaleX: 1.4,
      scaleY: 1.4,
      alpha: 0.05,
      duration: 1200,
      repeat: -1,
      yoyo: true,
      ease: "Sine.easeInOut",
    });

    // Solid pin base
    const pin = this.scene.add.circle(0, 0, 10, pinColor, 0.95);
    const stroke = this.scene.add.circle(0, 0, 10);
    stroke.setStrokeStyle(2, 0xffffff, 0.9);

    // Emoji icon / badge
    const iconText = this.scene.add.text(0, -1, icon, { fontSize: "11px" });
    iconText.setOrigin(0.5);

    // POI title banner
    const title = this.scene.add.text(0, -22, poi.displayName, {
      fontSize: "11px",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontStyle: "bold",
      color: "#ffffff",
      backgroundColor: "rgba(15, 23, 42, 0.9)",
      padding: { x: 6, y: 2 },
    });
    title.setOrigin(0.5);

    container.add([halo, pin, stroke, iconText, title]);

    // Interactive hit area
    container.setSize(80, 50);
    container.setInteractive({ useHandCursor: true });

    container.on("pointerover", () => {
      container.setScale(1.15);
      title.setBackgroundColor("rgba(30, 41, 59, 1)");
    });

    container.on("pointerout", () => {
      container.setScale(1.0);
      title.setBackgroundColor("rgba(15, 23, 42, 0.9)");
    });

    container.on("pointerdown", () => {
      if (this.onPOIClick) {
        this.onPOIClick(poi);
      }
    });

    return container;
  }

  /**
   * Animates a transit vehicle ('Along' bus or 'Bolt' cab) following
   * the exact curvature of Abuja's real road network.
   */
  public animateTransitVehicle(
    waypoints: PathfindingWaypoint[],
    tier: "ALONG" | "BOLT",
    onComplete?: () => void
  ): void {
    if (!waypoints || waypoints.length < 2) {
      if (onComplete) onComplete();
      return;
    }

    const screenPoints = waypoints.map((wp) => gridToScreen(wp.x, wp.y));

    // Vehicle container
    const startPoint = screenPoints[0]!;
    const vehicle = this.scene.add.container(startPoint.x, startPoint.y);

    const vehicleColor = tier === "ALONG" ? 0x16a34a : 0x0f172a; // Green Along vs Sleek Dark Bolt
    const body = this.scene.add.rectangle(0, 0, tier === "ALONG" ? 22 : 18, 12, vehicleColor);
    body.setStrokeStyle(1.5, tier === "ALONG" ? 0xfacc15 : 0x10b981); // Yellow along stripe / green Bolt accent

    const label = this.scene.add.text(0, -14, tier === "ALONG" ? "🚌 ALONG" : "🚗 BOLT", {
      fontSize: "10px",
      fontFamily: "Arial, sans-serif",
      fontStyle: "bold",
      color: "#ffffff",
      backgroundColor: "rgba(0,0,0,0.7)",
      padding: { x: 3, y: 1 },
    });
    label.setOrigin(0.5);

    vehicle.add([body, label]);
    this.transitVehicleContainer.add(vehicle);

    // Chain tweens along each road curved waypoint
    let step = 0;
    const moveToNextWaypoint = () => {
      step++;
      if (step >= screenPoints.length) {
        // Arrived at destination
        this.scene.tweens.add({
          targets: vehicle,
          alpha: 0,
          duration: 400,
          onComplete: () => {
            vehicle.destroy();
            if (onComplete) onComplete();
          },
        });
        return;
      }

      const target = screenPoints[step]!;
      const wp = waypoints[step]!;
      // Speed multiplier influences step duration
      const speedFactor = wp.speed ? Math.max(0.5, wp.speed / 40) : 1.0;
      const duration = Math.max(120, Math.round(260 / speedFactor));

      this.scene.tweens.add({
        targets: vehicle,
        x: target.x,
        y: target.y,
        duration,
        ease: "Linear",
        onComplete: moveToNextWaypoint,
      });
    };

    moveToNextWaypoint();
  }

  /**
   * Destroys all graphics layers upon scene teardown.
   */
  public destroy(): void {
    this.waterGraphics.destroy();
    this.roadBaseGraphics.destroy();
    this.roadMarkingGraphics.destroy();
    this.roundaboutGraphics.destroy();
    this.poiContainer.destroy();
    this.transitVehicleContainer.destroy();
  }
}
