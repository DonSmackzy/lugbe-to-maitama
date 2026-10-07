// =============================================================================
// WorldRoom — Colyseus Authoritative Game Room
// State Authority: Owns process memory state.
// Relies on Engine for pure logic, Redis for snapshots/rate limits, Postgres for ledger.
// =============================================================================

import { Room, Client } from "@colyseus/core";
import { WorldRoomState, PlayerSchema } from "./schema/WorldRoomState.js";
import {
  resolve,
  applyEffects,
  advance,
  NavGrid,
  type WorldState,
  type ActorState,
  type District,
  type RuleDefinition,
  type PositionEffect,
  firstError,
  hasError,
} from "@ltm/engine";
import type { CityPack } from "@ltm/city-schema";
import type { ClientIntent } from "@ltm/protocol";
import { playerSerial } from "../concurrency/PlayerSerial.js";
import { commitEffectsToLedger, type SpatialSnapshot } from "../economy/ledger.js";
import {
  saveRoomSnapshot,
  getRoomSnapshot,
  deleteRoomSnapshot,
  checkRateLimit,
  type RoomSnapshot,
} from "../storage/redis.js";
import fs from "fs";
import path from "path";

export interface JoinOptions {
  accountId?: string;
  username?: string;
  startingDistrict?: string;
  disclaimerAccepted?: boolean;
  disclaimerAcceptedAt?: number;
}

export class WorldRoom extends Room<{ state: WorldRoomState }> {
  private world!: WorldState;
  private packId = "abuja_v1";
  private snapshotCounter = 0;

  async onCreate(options: Record<string, unknown>): Promise<void> {
    this.setState(new WorldRoomState());

    // 1. Ingest validated City Pack & rules from city-packs/abuja
    const pack = this.loadCityPack();
    const districts = this.loadDistricts();
    const rules = this.loadRules();

    const navGrid = new NavGrid(
      pack.gridWidth,
      pack.gridHeight,
      pack.zones,
      districts
    );

    const actors = new Map<string, ActorState>();
    const players = new Map<string, ActorState>();
    const npcs = new Map();
    const marketMultipliers = new Map<string, number>();

    this.world = {
      roomId: this.roomId,
      cityPack: pack,
      districts,
      rules,
      navGrid,
      tick: 0,
      timeMs: 0,
      day: 1,
      ticksPerDay: 48,
      actors,
      players,
      npcs,
      marketMultipliers,
    };

    // 2. Attempt crash-recovery restoration from Redis
    const snapshot = await getRoomSnapshot(this.roomId);
    if (snapshot) {
      console.log(`[room:${this.roomId}] Recovered crash recovery snapshot from tick ${snapshot.tick}`);
      this.world.tick = snapshot.tick;
      this.world.day = snapshot.day;
      this.state.tick = snapshot.tick;
      this.state.day = snapshot.day;
    }

    // 3. Register client intent handler
    this.onMessage("intent", async (client: Client, rawIntent: ClientIntent & { idemKey?: string }) => {
      await this.handleClientIntent(client, rawIntent);
    });

    // 4. Start authoritative 1Hz simulation loop
    this.setSimulationInterval((dt) => {
      this.stepSimulation(dt);
    }, 1000);

    console.log(`[room:${this.roomId}] WorldRoom created and listening for intents`);
  }

  async onAuth(client: Client, options: JoinOptions): Promise<boolean> {
    if (!options || options.disclaimerAccepted !== true) {
      console.warn(
        `[security:unbypassable_disclaimer] Client ${client.sessionId} connection rejected. Satire disclaimer was not accepted.`
      );
      throw new Error(
        "REJECTED: Statutory satire disclaimer must be accepted before connecting to the server."
      );
    }

    const timestamp = options.disclaimerAcceptedAt || Date.now();
    console.log(
      `[security:audit] Client ${client.sessionId} (account: ${options.accountId ?? "anon"}) acknowledged statutory satire disclaimer at ${new Date(timestamp).toISOString()}`
    );
    return true;
  }

  onJoin(client: Client, options: JoinOptions): void {
    if (!options || options.disclaimerAccepted !== true) {
      throw new Error(
        "REJECTED: Statutory satire disclaimer must be accepted before connecting to the server."
      );
    }
    const accountId = options.accountId || `acc_${client.sessionId}`;
    const startingDistrictId = options.startingDistrict || "lugbe";
    const district = this.world.districts.find((d) => d.id === startingDistrictId);

    const actor: ActorState = {
      id: client.sessionId,
      playerId: client.sessionId,
      accountId,
      position: { x: 10, y: 10 },
      balanceKobo: this.world.cityPack.startingCashKobo,
      socialCapital: this.world.cityPack.startingSocialCapital,
      energy: 100,
      home: {
        districtId: startingDistrictId,
        ...(district ? { district } : {}),
      },
      inventory: new Map<string, number>(),
      pendingFiles: new Map<string, number>(),
      processedIdemKeys: new Set<string>(),
    };

    this.world.actors.set(client.sessionId, actor);
    this.world.players.set(client.sessionId, actor);

    // Sync to Colyseus client state schema
    const playerSchema = new PlayerSchema();
    playerSchema.id = client.sessionId;
    playerSchema.accountId = accountId;
    playerSchema.x = actor.position.x;
    playerSchema.y = actor.position.y;
    playerSchema.balanceKobo = actor.balanceKobo;
    playerSchema.socialCapital = actor.socialCapital;
    playerSchema.energy = actor.energy;
    playerSchema.districtId = startingDistrictId;

    this.state.players.set(client.sessionId, playerSchema);

    client.send("welcome", {
      playerId: client.sessionId,
      packId: this.packId,
      tick: this.world.tick,
      day: this.world.day,
    });

    console.log(`[room:${this.roomId}] Client ${client.sessionId} joined as ${accountId}`);
  }

  async onLeave(client: Client, _code?: number): Promise<void> {
    playerSerial.clear(client.sessionId);
    this.world.actors.delete(client.sessionId);
    this.world.players.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    console.log(`[room:${this.roomId}] Client ${client.sessionId} departed`);
  }

  async onDispose(): Promise<void> {
    await this.persistSnapshot();
    await deleteRoomSnapshot(this.roomId);
    console.log(`[room:${this.roomId}] Room disposed gracefully`);
  }

  // ---------------------------------------------------------------------------
  // Intent Processing & Concurrency Pipeline
  // ---------------------------------------------------------------------------

  private async handleClientIntent(
    client: Client,
    intent: ClientIntent & { idemKey?: string; seq?: number }
  ): Promise<void> {
    const actor = this.world.actors.get(client.sessionId);
    if (!actor) {
      client.send("error", { code: "NOT_JOINED", message: "Actor not found in room" });
      return;
    }

    // 1. Rate limiting via Redis / token bucket
    const rateCheck = await checkRateLimit(actor.accountId, intent.type, 10, 1);
    if (!rateCheck.allowed) {
      client.send("error", {
        code: "RATE_LIMITED",
        message: "You are dispatching intents too fast. Please slow down.",
      });
      return;
    }

    // 2. Strict per-player serialization queue (zero parallel writes for same player)
    await playerSerial.enqueue(client.sessionId, async () => {
      const idemKey = intent.idemKey || `tx_${actor.id}_${Date.now()}`;

      // A. Evaluate pure engine logic
      const effects = resolve(this.world, actor, intent, idemKey);

      if (hasError(effects)) {
        const err = firstError(effects);
        client.send("error", {
          code: err?.code ?? "INTERNAL_ERROR",
          message: err?.message ?? "Intent rejected",
        });
        return;
      }

      // Extract optional spatial snapshot if intent moved/commuted the player
      const posEffect = effects.find((e) => e.kind === "POSITION") as PositionEffect | undefined;
      const spatialSnapshot: SpatialSnapshot | undefined = posEffect
        ? {
            x: posEffect.toX,
            y: posEffect.toY,
            districtId: posEffect.enteredZoneId ?? (actor.home?.districtId || "lugbe"),
          }
        : undefined;

      // B. Wire up Postgres append-only ledger if cash was affected or spatial state changed
      const ledgerResult = await commitEffectsToLedger(
        actor,
        effects,
        this.packId,
        spatialSnapshot
      );
      if (!ledgerResult.ok) {
        client.send("error", {
          code: ledgerResult.code,
          message: ledgerResult.message,
        });
        return;
      }

      // C. Mutate authoritative in-memory state
      applyEffects(actor, effects);

      // D. Sync changes to Colyseus Schema
      const playerSchema = this.state.players.get(client.sessionId);
      if (playerSchema) {
        playerSchema.x = actor.position.x;
        playerSchema.y = actor.position.y;
        playerSchema.balanceKobo = actor.balanceKobo;
        playerSchema.socialCapital = actor.socialCapital;
        playerSchema.energy = actor.energy;

        // Sync inventory changes (and clean zeroed/deleted items)
        for (const [itemId] of playerSchema.inventory) {
          if (!actor.inventory.has(itemId)) {
            playerSchema.inventory.delete(itemId);
          }
        }
        actor.inventory.forEach((qty, itemId) => {
          playerSchema.inventory.set(itemId, qty);
        });
      }

      // E. Send ACK (with seq, x, y for client-side reconciliation)
      client.send("ack", {
        idemKey,
        seq: intent.seq,
        type: intent.type,
        x: actor.position.x,
        y: actor.position.y,
        lat: posEffect?.lat,
        lng: posEffect?.lng,
        pathWaypoints: posEffect?.pathWaypoints,
        transitTier: posEffect?.transitTier,
        balanceKobo: actor.balanceKobo,
        effects,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Simulation Step & Snapshotting
  // ---------------------------------------------------------------------------

  private stepSimulation(dt: number): void {
    const result = advance(this.world, dt);
    this.state.tick = this.world.tick;
    this.state.day = this.world.day;

    // Sync updated energies / day tick results to player schemas
    for (const [actorId, actor] of this.world.actors.entries()) {
      const schema = this.state.players.get(actorId);
      if (schema) {
        schema.energy = actor.energy;
        schema.socialCapital = actor.socialCapital;
      }
    }

    // Periodic Redis snapshotting every 30 seconds
    this.snapshotCounter += dt;
    if (this.snapshotCounter >= 30000) {
      this.snapshotCounter = 0;
      void this.persistSnapshot();
    }
  }

  private async persistSnapshot(): Promise<void> {
    const actorsData: RoomSnapshot["actors"] = Array.from(this.world.actors.values()).map((a) => ({
      id: a.id,
      accountId: a.accountId,
      balanceKobo: a.balanceKobo,
      socialCapital: a.socialCapital,
      energy: a.energy,
      position: a.position,
      inventory: Array.from(a.inventory.entries()) as [string, number][],
    }));

    const snapshot: RoomSnapshot = {
      roomId: this.roomId,
      packId: this.packId,
      tick: this.world.tick,
      day: this.world.day,
      timestamp: Date.now(),
      actors: actorsData,
    };

    await saveRoomSnapshot(this.roomId, snapshot);
  }

  // ---------------------------------------------------------------------------
  // City Pack Loaders
  // ---------------------------------------------------------------------------

  private findWorkspaceRoot(): string {
    let dir = process.cwd();
    for (let i = 0; i < 4; i++) {
      if (fs.existsSync(path.join(dir, "city-packs/abuja/districts.json"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return process.cwd();
  }

  private loadCityPack(): CityPack {
    const root = this.findWorkspaceRoot();
    const packPath = path.resolve(root, "city-packs/abuja/abuja_v1.json");
    if (fs.existsSync(packPath)) {
      return JSON.parse(fs.readFileSync(packPath, "utf-8")) as CityPack;
    }
    // Fallback minimal pack
    return {
      schemaVersion: "1.0.0",
      packId: "abuja_v1",
      displayName: "Abuja",
      gridWidth: 120,
      gridHeight: 120,
      startingCashKobo: 500000 as any,
      startingSocialCapital: 10 as any,
      zones: [],
      items: [],
      npcArchetypes: [],
      bureaucracyRules: [],
    };
  }

  private loadDistricts(): District[] {
    const root = this.findWorkspaceRoot();
    const filePath = path.resolve(root, "city-packs/abuja/districts.json");
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { districts: District[] };
      return data.districts;
    }
    return [];
  }

  private loadRules(): RuleDefinition[] {
    const root = this.findWorkspaceRoot();
    const filePath = path.resolve(root, "city-packs/abuja/rules.json");
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { rules: RuleDefinition[] };
      return data.rules;
    }
    return [];
  }
}
