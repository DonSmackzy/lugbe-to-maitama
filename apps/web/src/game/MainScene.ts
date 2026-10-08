// =============================================================================
// Phaser 3 Isometric Game Scene — apps/web/src/game/MainScene.ts
// Performance & Renderer:
// - Isometric Tiled map loaded dynamically.
// - 30 FPS capped loop.
// - Camera culling: entities and landmark structures culled outside viewport.
// - Strict Y-Sorting: depth sorting based on isometric gridX + gridY.
// - Sequence-based prediction & reconciliation with zero rubber-banding.
// =============================================================================

import Phaser from "phaser";
import {
  gridToScreen,
  screenToGrid,
  calculateDepth,
  TILE_WIDTH,
  TILE_HEIGHT,
} from "./IsometricMath.js";
import { PredictionManager, type MoveIntentPayload } from "./PredictionManager.js";
import { GeoJsonMapRenderer } from "./GeoJsonMapRenderer.js";
import { geoToGrid, DEFAULT_GRID_DIMENSIONS } from "@ltm/engine";
import type { CulturePOI } from "@ltm/city-schema";
import type { ColyseusGameClient } from "../network/ColyseusClient.js";
import type { GameHUD } from "../ui/GameHUD.js";

export interface SceneInitData {
  colyseusClient: ColyseusGameClient;
  hud: GameHUD;
  startingDistrict?: string;
  username: string;
}

/**
 * Authentic WGS84 GPS spawn locations for major Abuja districts along the road network.
 */
export const DISTRICT_SPAWN_GEO: Record<string, { lat: number; lng: number }> = {
  lugbe: { lat: 8.9650, lng: 7.3680 }, // Lugbe FHA along Airport Road (Grid: 16, 105)
  wuse: { lat: 9.0620, lng: 7.4680 }, // Berger Roundabout (Grid: 73, 50)
  garki: { lat: 9.0265, lng: 7.4720 }, // Area 1 / Federal Secretariat (Grid: 75, 70)
  gwarinpa: { lat: 9.1080, lng: 7.4120 }, // Gwarinpa 3rd Avenue (Grid: 41, 24)
  maitama: { lat: 9.0880, lng: 7.4980 }, // Maitama Diplomatic Zone (Grid: 90, 35)
  the_villa: { lat: 9.0560, lng: 7.5400 }, // Aso Rock Presidential Villa (Grid: 113, 53)
  karu: { lat: 8.9950, lng: 7.5300 }, // Karu / Nyanya corridor
  central_market: { lat: 9.0550, lng: 7.4580 }, // Central Market Area
};

export class MainScene extends Phaser.Scene {
  private colyseusClient!: ColyseusGameClient;
  private hud!: GameHUD;
  private username = "Citizen";
  private startingDistrict = "lugbe";

  private predictionManager!: PredictionManager;
  private playerSprite!: Phaser.GameObjects.Container;
  private otherPlayerSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private npcSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private geoMapRenderer!: GeoJsonMapRenderer;

  // Input keys
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private lastMoveInputTime = 0;
  private moveInputThrottleMs = 150; // Snappy movement cadence

  // Tilemap layer reference
  private groundLayer!: Phaser.Tilemaps.TilemapLayer | null;

  constructor() {
    super({ key: "MainScene" });
  }

  init(data: SceneInitData): void {
    this.colyseusClient = data.colyseusClient;
    this.hud = data.hud;
    this.username = data.username || "Citizen";
    this.startingDistrict = data.startingDistrict || "lugbe";

    // Project real-world WGS84 coordinates to game grid
    const targetGeo = DISTRICT_SPAWN_GEO[this.startingDistrict] ?? DISTRICT_SPAWN_GEO.lugbe!;
    const startGrid = geoToGrid(targetGeo);

    this.predictionManager = new PredictionManager(startGrid.x, startGrid.y);
  }

  preload(): void {
    // 1. Dynamically load Tiled JSON isometric map
    this.load.tilemapTiledJSON(
      "abuja_map",
      "/assets/maps/abuja_isometric_map.json"
    );

    // 2. Load isometric tileset PNG
    this.load.image("abuja_tileset", "/assets/tiles/abuja_tiles.png");
  }

  create(): void {
    this.createProceduralTextures();

    // 1. Build Isometric Tilemap (render at base depth 0)
    try {
      const map = this.make.tilemap({ key: "abuja_map" });
      const tileset = map.addTilesetImage("abuja_tiles", "abuja_tileset");
      if (tileset) {
        this.groundLayer = map.createLayer("Ground", tileset, 0, 0);
        if (this.groundLayer) {
          this.groundLayer.setDepth(0);
          this.groundLayer.setCullPadding(4, 4);
        }
      }
    } catch (e) {
      console.warn("[scene] Tilemap load fallback active:", e);
    }

    // 2. Spawn Real-World GIS GeoJSON Map (Roads, Jabi Lake, Roundabouts, Cultural POIs at depth 0)
    this.geoMapRenderer = new GeoJsonMapRenderer({
      scene: this,
      onPOIClick: (poi) => this.handlePOIClick(poi),
    });

    // 3. Spawn NPCs directly aligned on the GIS road network (depth >= 10)
    this.spawnNPCs();

    // 4. Create Local Player Avatar Container (Strict Z-Indexing: depth >= 10)
    const startScreen = gridToScreen(
      this.predictionManager.predictedX,
      this.predictionManager.predictedY
    );
    this.playerSprite = this.createAvatar(
      startScreen.x,
      startScreen.y,
      this.username,
      0x00e676,
      true
    );
    this.playerSprite.setDepth(
      calculateDepth(
        this.predictionManager.predictedX,
        this.predictionManager.predictedY,
        10
      )
    );

    // 5. Setup Camera & Laterite Earth Environment (#8B5A2B)
    this.cameras.main.setBackgroundColor("#8B5A2B");

    // Calculate Cartesian pixel bounds from the projection
    const pTop = gridToScreen(0, 0);
    const pRight = gridToScreen(DEFAULT_GRID_DIMENSIONS.gridWidth - 1, 0);
    const pLeft = gridToScreen(0, DEFAULT_GRID_DIMENSIONS.gridHeight - 1);
    const pBottom = gridToScreen(
      DEFAULT_GRID_DIMENSIONS.gridWidth - 1,
      DEFAULT_GRID_DIMENSIONS.gridHeight - 1
    );

    const minPixelX = Math.min(pTop.x, pRight.x, pLeft.x, pBottom.x);
    const maxPixelX = Math.max(pTop.x, pRight.x, pLeft.x, pBottom.x);
    const minPixelY = Math.min(pTop.y, pRight.y, pLeft.y, pBottom.y);
    const maxPixelY = Math.max(pTop.y, pRight.y, pLeft.y, pBottom.y);

    const camPadding = 600;
    const boundsX = minPixelX - camPadding;
    const boundsY = minPixelY - camPadding;
    const boundsWidth = maxPixelX - minPixelX + camPadding * 2;
    const boundsHeight = maxPixelY - minPixelY + camPadding * 2;

    this.cameras.main.setBounds(boundsX, boundsY, boundsWidth, boundsHeight);
    this.cameras.main.startFollow(this.playerSprite, true, 0.1, 0.1);
    this.cameras.main.setZoom(1.1);

    // 6. Setup Keyboard Input
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
      this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.keyS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    }

    // 7. Click-to-Move Input
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      // Only process clicks on world canvas (left click)
      if (pointer.button !== 0) return;

      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      const targetGrid = screenToGrid(worldX, worldY);

      const dx = Math.sign(targetGrid.gridX - this.predictionManager.predictedX);
      const dy = Math.sign(targetGrid.gridY - this.predictionManager.predictedY);

      if (dx !== 0 || dy !== 0) {
        this.dispatchMove(dx, dy);
      }
    });

    // 8. Wire up Colyseus Server ACK & Reconciliation
    this.colyseusClient.onAck((ack) => {
      if (ack.type === "MOVE" && ack.x !== undefined && ack.y !== undefined) {
        // Sequence-based reconciliation: snap baseline & re-apply remaining local intents
        const reconciled = this.predictionManager.reconcile(
          ack.x,
          ack.y,
          ack.seq
        );

        // Update local avatar position
        const scr = gridToScreen(reconciled.x, reconciled.y);
        this.playerSprite.setPosition(scr.x, scr.y);
        this.playerSprite.setDepth(
          calculateDepth(reconciled.x, reconciled.y, 10)
        );
      }

      // Animate Along / Bolt transit vehicle along real road curvature
      if (ack.pathWaypoints && ack.pathWaypoints.length > 1) {
        this.geoMapRenderer.animateTransitVehicle(
          ack.pathWaypoints as any,
          (ack.transitTier as "ALONG" | "BOLT") ?? "ALONG"
        );
      }

      // Update HUD wallet
      if (ack.balanceKobo !== undefined) {
        this.hud.update({
          username: this.username,
          districtId: this.getDistrictAt(
            this.predictionManager.predictedX,
            this.predictionManager.predictedY
          ),
          balanceKobo: ack.balanceKobo,
          energy: 95,
          socialCapital: 10,
        });
      }
    });

    // 9. Wire up Colyseus Dialogue Event
    this.colyseusClient.onDialogue((dialogue) => {
      this.hud.showDialogue(
        dialogue.npcName,
        dialogue.archetype,
        dialogue.text
      );
    });

    // 10. Wire up Colyseus Error Event
    this.colyseusClient.onError((err) => {
      console.warn("[game] Server rejected intent:", err);
    });

    // 11. Wire up Colyseus Room State Synchronization
    const room = this.colyseusClient.getRoom();
    if (room) {
      room.state.players.onAdd((player: any, key: string) => {
        if (key === room.sessionId) return; // Ignore local player

        const initialGrid = (player.lat !== undefined && player.lng !== undefined)
          ? geoToGrid({ lat: player.lat, lng: player.lng })
          : { x: player.x || 16, y: player.y || 105 };
        const scr = gridToScreen(initialGrid.x, initialGrid.y);
        const remoteAvatar = this.createAvatar(
          scr.x,
          scr.y,
          `Citizen_${key.substring(0, 4)}`,
          0x38bdf8,
          false
        );
        remoteAvatar.setDepth(calculateDepth(initialGrid.x, initialGrid.y, 10));
        this.otherPlayerSprites.set(key, remoteAvatar);

        player.onChange(() => {
          const currentGrid = (player.lat !== undefined && player.lng !== undefined)
            ? geoToGrid({ lat: player.lat, lng: player.lng })
            : { x: player.x || 16, y: player.y || 105 };
          const targetScr = gridToScreen(currentGrid.x, currentGrid.y);
          this.tweens.add({
            targets: remoteAvatar,
            x: targetScr.x,
            y: targetScr.y,
            duration: 100,
            ease: "Linear",
          });
          remoteAvatar.setDepth(calculateDepth(currentGrid.x, currentGrid.y, 10));
        });
      });

      room.state.players.onRemove((_player: any, key: string) => {
        const sprite = this.otherPlayerSprites.get(key);
        if (sprite) {
          sprite.destroy();
          this.otherPlayerSprites.delete(key);
        }
      });
    }

    // 12. Hook HUD Actions
    this.hud.onAction((action) => {
      this.handleHUDAction(action);
    });

    // Initial HUD push
    this.hud.update({
      username: this.username,
      districtId: this.startingDistrict,
      balanceKobo: 500000,
      energy: 100,
      socialCapital: 10,
    });
  }

  update(time: number, _delta: number): void {
    // Check Keyboard Movement Input
    if (time - this.lastMoveInputTime > this.moveInputThrottleMs) {
      let dx = 0;
      let dy = 0;

      if (this.keyW?.isDown || this.cursors?.up.isDown) {
        dy -= 1;
      } else if (this.keyS?.isDown || this.cursors?.down.isDown) {
        dy += 1;
      } else if (this.keyA?.isDown || this.cursors?.left.isDown) {
        dx -= 1;
      } else if (this.keyD?.isDown || this.cursors?.right.isDown) {
        dx += 1;
      }

      if (dx !== 0 || dy !== 0) {
        this.dispatchMove(dx, dy);
        this.lastMoveInputTime = time;
      }
    }

    // PERFORMANCE: Camera Viewport Culling
    // Only entities within viewport are rendered / updated
    const camera = this.cameras.main;
    const bounds = camera.worldView;
    const padding = 100;

    // Cull other player avatars
    for (const [_key, sprite] of this.otherPlayerSprites) {
      const isVisible =
        sprite.x >= bounds.x - padding &&
        sprite.x <= bounds.x + bounds.width + padding &&
        sprite.y >= bounds.y - padding &&
        sprite.y <= bounds.y + bounds.height + padding;
      sprite.setVisible(isVisible);
    }

    // Cull NPC avatars
    for (const [_key, sprite] of this.npcSprites) {
      const isVisible =
        sprite.x >= bounds.x - padding &&
        sprite.x <= bounds.x + bounds.width + padding &&
        sprite.y >= bounds.y - padding &&
        sprite.y <= bounds.y + bounds.height + padding;
      sprite.setVisible(isVisible);
    }
  }

  /**
   * Dispatches a predicted movement intent.
   * Updates local predicted coordinates immediately and sends intent to Colyseus.
   */
  private dispatchMove(dx: number, dy: number): void {
    const intent: MoveIntentPayload | null = this.predictionManager.predictMove(
      dx,
      dy,
      (targetX, targetY) => !this.isBlockedTile(targetX, targetY)
    );

    if (!intent) return;

    // Immediately reflect snappy predicted move locally
    const screenPos = gridToScreen(
      this.predictionManager.predictedX,
      this.predictionManager.predictedY
    );
    this.playerSprite.setPosition(screenPos.x, screenPos.y);

    // STRICT Z-INDEXING: Depth >= 10
    this.playerSprite.setDepth(
      calculateDepth(
        this.predictionManager.predictedX,
        this.predictionManager.predictedY,
        10
      )
    );

    // Send MOVE intent to Colyseus room
    this.colyseusClient.sendIntent({
      type: "MOVE",
      toX: intent.targetX,
      toY: intent.targetY,
      seq: intent.seq,
      idemKey: intent.idemKey,
    });

    // Update HUD district badge
    const currentDistrict = this.getDistrictAt(
      this.predictionManager.predictedX,
      this.predictionManager.predictedY
    );
    this.hud.update({
      username: this.username,
      districtId: currentDistrict,
      balanceKobo: 500000,
      energy: Math.max(20, 100 - Math.floor(intent.seq / 5)),
      socialCapital: 10,
    });
  }

  /**
   * Creates an isometric avatar container with depth, shadow, and nametag.
   */
  private createAvatar(
    x: number,
    y: number,
    name: string,
    accentColor: number,
    isLocal: boolean
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);

    // Shadow ellipse
    const shadow = this.add.ellipse(0, 10, 24, 12, 0x000000, 0.4);

    // Body capsule
    const body = this.add.graphics();
    body.fillStyle(accentColor, 1);
    body.fillRoundedRect(-10, -28, 20, 32, 6);

    // Head
    const head = this.add.circle(0, -32, 9, 0xffdbac);

    // Cap / Agbada trim
    const cap = this.add.ellipse(0, -38, 14, 6, accentColor, 1);

    // Name label
    const nametag = this.add.text(0, -50, name, {
      fontFamily: "system-ui, sans-serif",
      fontSize: "11px",
      fontStyle: isLocal ? "bold" : "normal",
      color: isLocal ? "#00e676" : "#ffffff",
      stroke: "#000000",
      strokeThickness: 3,
    });
    nametag.setOrigin(0.5);

    container.add([shadow, body, head, cap, nametag]);
    return container;
  }

  /**
   * Spawns canonical NPCs: Along Driver, Civil Servant, and The President
   * accurately aligned with the Abuja road network via GIS projection.
   */
  private spawnNPCs(): void {
    const npcs = [
      {
        id: "alhaji_tanko",
        name: "Alhaji Tanko (Along Driver)",
        geo: { lat: 8.9650, lng: 7.3680 }, // Lugbe FHA on Airport Road (Grid: 16, 105)
        color: 0xf59e0b,
        archetype: "along_driver",
      },
      {
        id: "director_yusuf",
        name: "Director Yusuf (Civil Servant)",
        geo: { lat: 9.0265, lng: 7.4720 }, // Federal Secretariat / Garki (Grid: 75, 70)
        color: 0x64748b,
        archetype: "civil_servant",
      },
      {
        id: "the_president",
        name: "The President (Head of State)",
        geo: { lat: 9.0560, lng: 7.5400 }, // Aso Rock Presidential Villa (Grid: 113, 53)
        color: 0xd97706,
        archetype: "head_of_state",
      },
    ];

    for (const npc of npcs) {
      const grid = geoToGrid(npc.geo);
      const scr = gridToScreen(grid.x, grid.y);
      const avatar = this.createAvatar(
        scr.x,
        scr.y,
        npc.name,
        npc.color,
        false
      );

      // Make clickable to talk
      avatar.setSize(40, 60);
      avatar.setInteractive({ useHandCursor: true });
      avatar.on("pointerdown", () => {
        this.talkToNPC(npc.id, npc.name, npc.archetype);
      });

      // Strict Z-Indexing: NPC sprites render at depth >= 10
      avatar.setDepth(calculateDepth(grid.x, grid.y, 10));
      this.npcSprites.set(npc.id, avatar);
    }
  }

  private talkToNPC(npcId: string, npcName: string, archetype: string): void {
    this.colyseusClient.sendIntent({
      type: "TALK",
      npcInstanceId: npcId,
      idemKey: `talk_${npcId}_${Date.now()}`,
    });

    // Optimistic fallback display while LLM processes
    let fallback = "Along! Along! Wuse Along! Watch out for traffic on Airport Road.";
    if (archetype === "civil_servant") {
      fallback = "File 4B is pending ministerial assent. Please return on Thursday.";
    } else if (archetype === "head_of_state") {
      fallback = "Security protocol Alpha is in effect throughout the Villa precinct.";
    }

    this.hud.showDialogue(npcName, archetype, fallback);
  }

  private handleHUDAction(action: string): void {
    switch (action) {
      case "COMMUTE":
        this.colyseusClient.sendIntent({
          type: "TRANSIT",
          tier: "ALONG",
          toX: 73,
          toY: 50, // Berger Underbridge (Along Park)
          idemKey: `transit_along_${Date.now()}`,
        });
        break;
      case "COMMUTE_BOLT":
        this.colyseusClient.sendIntent({
          type: "TRANSIT",
          tier: "BOLT",
          toX: 80,
          toY: 46, // Zone 4 BDC Hub / Wuse
          idemKey: `transit_bolt_${Date.now()}`,
        });
        break;
      case "BUY_GALA":
        this.colyseusClient.sendIntent({
          type: "BUY",
          itemId: "gala_sausage",
          quantity: 1,
          idemKey: `buy_gala_${Date.now()}`,
        });
        break;
      case "BUY_WATER":
        this.colyseusClient.sendIntent({
          type: "BUY",
          itemId: "pure_water",
          quantity: 1,
          idemKey: `buy_water_${Date.now()}`,
        });
        break;
    }
  }

  private isBlockedTile(x: number, y: number): boolean {
    // District boundary checks
    if (x < 0 || x > 119 || y < 0 || y > 119) return true;

    // Garki Secretariat blocked security zones
    if (x >= 70 && x <= 72 && y >= 35 && y <= 36) return true;

    return false;
  }

  private getDistrictAt(x: number, y: number): string {
    if (x >= 100 && y <= 65) return "the_villa";
    if (x >= 75 && y <= 45) return "maitama";
    if (x >= 60 && y >= 65) return "garki";
    if (x >= 60 && x < 90 && y >= 40 && y < 65) return "wuse";
    if (x <= 35 && y >= 70) return "lugbe";
    if (x < 60 && y < 45) return "gwarinpa";
    if (x >= 90 && y >= 70) return "karu";
    return "central_market";
  }

  private handlePOIClick(poi: CulturePOI): void {
    const perk = poi.culturalPerk ? `\n[Cultural Perk]: ${poi.culturalPerk.description}` : "";
    this.hud.showDialogue(
      poi.displayName,
      poi.category,
      `${poi.description}${perk}`
    );
  }

  private createProceduralTextures(): void {
    // Textures generated dynamically if tilemap image is pending
    if (!this.textures.exists("tile_fallback")) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0x3b82f6, 1);
      g.fillPoints([
        new Phaser.Geom.Point(32, 0),
        new Phaser.Geom.Point(64, 16),
        new Phaser.Geom.Point(32, 32),
        new Phaser.Geom.Point(0, 16),
      ]);
      g.generateTexture("tile_fallback", TILE_WIDTH, TILE_HEIGHT);
    }
  }
}
