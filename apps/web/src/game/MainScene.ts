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
import type { ColyseusGameClient } from "../network/ColyseusClient.js";
import type { GameHUD } from "../ui/GameHUD.js";

export interface SceneInitData {
  colyseusClient: ColyseusGameClient;
  hud: GameHUD;
  startingDistrict?: string;
  username: string;
}

interface Landmark {
  id: string;
  name: string;
  gridX: number;
  gridY: number;
  widthTiles: number;
  heightTiles: number;
  color: number;
  label: string;
}

export class MainScene extends Phaser.Scene {
  private colyseusClient!: ColyseusGameClient;
  private hud!: GameHUD;
  private username = "Citizen";
  private startingDistrict = "lugbe";

  private predictionManager!: PredictionManager;
  private playerSprite!: Phaser.GameObjects.Container;
  private otherPlayerSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private npcSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private landmarkSprites: Phaser.GameObjects.Container[] = [];

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

    // Set starting grid coordinates based on district
    let startX = 10;
    let startY = 10;
    if (this.startingDistrict === "karu") {
      startX = 20;
      startY = 95;
    } else if (this.startingDistrict === "gwarinpa") {
      startX = 15;
      startY = 45;
    }

    this.predictionManager = new PredictionManager(startX, startY);
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

    // 1. Build Isometric Tilemap
    try {
      const map = this.make.tilemap({ key: "abuja_map" });
      const tileset = map.addTilesetImage("abuja_tiles", "abuja_tileset");
      if (tileset) {
        this.groundLayer = map.createLayer("Ground", tileset, 0, 0);
        if (this.groundLayer) {
          // Camera culling for map tiles
          this.groundLayer.setCullPadding(4, 4);
        }
      }
    } catch (e) {
      console.warn("[scene] Tilemap load fallback active:", e);
    }

    // 2. Spawn Landmark Structures with Strict Y-Sorting
    this.spawnLandmarks();

    // 3. Spawn NPCs
    this.spawnNPCs();

    // 4. Create Local Player Avatar Container
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
        0.5
      )
    );

    // 5. Setup Camera
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
          calculateDepth(reconciled.x, reconciled.y, 0.5)
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

        const scr = gridToScreen(player.x || 10, player.y || 10);
        const remoteAvatar = this.createAvatar(
          scr.x,
          scr.y,
          `Citizen_${key.substring(0, 4)}`,
          0x38bdf8,
          false
        );
        remoteAvatar.setDepth(calculateDepth(player.x || 10, player.y || 10, 0.5));
        this.otherPlayerSprites.set(key, remoteAvatar);

        player.onChange(() => {
          const targetScr = gridToScreen(player.x, player.y);
          this.tweens.add({
            targets: remoteAvatar,
            x: targetScr.x,
            y: targetScr.y,
            duration: 100,
            ease: "Linear",
          });
          remoteAvatar.setDepth(calculateDepth(player.x, player.y, 0.5));
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

    // Cull landmark structures
    for (const structure of this.landmarkSprites) {
      const isVisible =
        structure.x >= bounds.x - padding &&
        structure.x <= bounds.x + bounds.width + padding &&
        structure.y >= bounds.y - padding &&
        structure.y <= bounds.y + bounds.height + padding;
      structure.setVisible(isVisible);
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

    // STRICT Y-SORTING: Depth = gridX + gridY
    this.playerSprite.setDepth(
      calculateDepth(
        this.predictionManager.predictedX,
        this.predictionManager.predictedY,
        0.5
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
   * Spawns landmark 2.5D isometric structures with strict Y-Sorting.
   */
  private spawnLandmarks(): void {
    const landmarks: Landmark[] = [
      {
        id: "lugbe_gate",
        name: "Lugbe Airport Rd Junction",
        gridX: 12,
        gridY: 12,
        widthTiles: 2,
        heightTiles: 2,
        color: 0xb45309,
        label: "LUGBE PARK",
      },
      {
        id: "wuse_market_hall",
        name: "Wuse Central Market",
        gridX: 45,
        gridY: 15,
        widthTiles: 4,
        heightTiles: 3,
        color: 0x475569,
        label: "WUSE MARKET",
      },
      {
        id: "garki_secretariat",
        name: "Federal Secretariat",
        gridX: 75,
        gridY: 15,
        widthTiles: 4,
        heightTiles: 4,
        color: 0x334155,
        label: "FEDERAL SECRETARIAT",
      },
      {
        id: "maitama_mansion",
        name: "Maitama Diplomatic Quarters",
        gridX: 75,
        gridY: 75,
        widthTiles: 5,
        heightTiles: 4,
        color: 0x065f46,
        label: "EMBASSY ROW",
      },
      {
        id: "the_villa_gatehouse",
        name: "Aso Rock Presidential Villa",
        gridX: 100,
        gridY: 100,
        widthTiles: 6,
        heightTiles: 6,
        color: 0x1e293b,
        label: "THE VILLA (APEX)",
      },
    ];

    for (const lm of landmarks) {
      const scr = gridToScreen(lm.gridX, lm.gridY);
      const container = this.add.container(scr.x, scr.y);

      // Isometric building block
      const gfx = this.add.graphics();
      gfx.fillStyle(lm.color, 0.9);
      // Isometric roof polygon
      gfx.fillPoints([
        new Phaser.Geom.Point(0, -60),
        new Phaser.Geom.Point(40, -40),
        new Phaser.Geom.Point(0, -20),
        new Phaser.Geom.Point(-40, -40),
      ]);

      // Building wall facets
      gfx.fillStyle(Phaser.Display.Color.IntegerToColor(lm.color).darken(20).color, 1);
      gfx.fillPoints([
        new Phaser.Geom.Point(-40, -40),
        new Phaser.Geom.Point(0, -20),
        new Phaser.Geom.Point(0, 10),
        new Phaser.Geom.Point(-40, -10),
      ]);

      gfx.fillStyle(Phaser.Display.Color.IntegerToColor(lm.color).darken(40).color, 1);
      gfx.fillPoints([
        new Phaser.Geom.Point(0, -20),
        new Phaser.Geom.Point(40, -40),
        new Phaser.Geom.Point(40, -10),
        new Phaser.Geom.Point(0, 10),
      ]);

      const labelText = this.add.text(0, -75, lm.label, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        fontStyle: "bold",
        color: "#fbbf24",
        stroke: "#000000",
        strokeThickness: 3,
      });
      labelText.setOrigin(0.5);

      container.add([gfx, labelText]);

      // STRICT Y-SORTING: Building depth matches its base grid coordinate
      container.setDepth(calculateDepth(lm.gridX, lm.gridY, 0));
      this.landmarkSprites.push(container);
    }
  }

  /**
   * Spawns canonical NPCs: Danfo Driver, Civil Servant, and The President.
   */
  private spawnNPCs(): void {
    const npcs = [
      {
        id: "alhaji_tanko",
        name: "Alhaji Tanko (Danfo Driver)",
        gridX: 14,
        gridY: 10,
        color: 0xf59e0b,
        archetype: "driver",
      },
      {
        id: "director_yusuf",
        name: "Director Yusuf (Civil Servant)",
        gridX: 72,
        gridY: 18,
        color: 0x64748b,
        archetype: "civil_servant",
      },
      {
        id: "the_president",
        name: "The President (Head of State)",
        gridX: 102,
        gridY: 102,
        color: 0xd97706,
        archetype: "head_of_state",
      },
    ];

    for (const npc of npcs) {
      const scr = gridToScreen(npc.gridX, npc.gridY);
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

      avatar.setDepth(calculateDepth(npc.gridX, npc.gridY, 0.4));
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
    let fallback = "Safe trip, my guy! Watch out for traffic on Airport Road.";
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
        // Move towards the expressway / commercial midtown
        this.dispatchMove(1, 0);
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
    if (x >= 90 && y >= 90) return "the_villa";
    if (x >= 60 && y >= 60) return "maitama";
    if (x >= 60 && y < 30) return "garki";
    if (x >= 30 && x < 60 && y < 60) return "wuse";
    if (x < 30 && y < 30) return "lugbe";
    if (y >= 90 && x < 60) return "karu";
    return "central_market";
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
