// =============================================================================
// Colyseus Server — Entry Point
// State authority. Clients send intents; server mutates state and ledger.
// =============================================================================

import { Server } from "@colyseus/core";
import { RedisPresence } from "@colyseus/redis-presence";
import express from "express";
import { WorldRoom } from "./rooms/WorldRoom.js";

const PORT = parseInt(process.env["PORT"] ?? "2567", 10);
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://:ltm_redis_secret@localhost:6379";

const app = express();
app.use(express.json());

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "colyseus-server",
    uptimeSec: Math.floor(process.uptime()),
    ts: Date.now(),
  });
});

// Initialize presence: use RedisPresence if configured
let presence: InstanceType<typeof RedisPresence> | undefined;
try {
  presence = new RedisPresence(REDIS_URL);
} catch (err) {
  console.warn("[server] RedisPresence initialization warning:", (err as Error).message);
}

const gameServer = new Server({
  ...(presence ? { presence } : {}),
  express: (serverApp) => {
    serverApp.use(app);
  },
});

// Register authoritative WorldRoom
gameServer.define("world_room", WorldRoom as any);

gameServer.listen(PORT).then(() => {
  console.log(`[server] Colyseus authoritative server listening on ws://localhost:${PORT}`);
  console.log(`[server] Health check available at http://localhost:${PORT}/health`);
}).catch((err) => {
  console.error("[server] Failed to start Colyseus server:", err);
});

process.on("SIGTERM", () => {
  console.log("[server] SIGTERM received, shutting down gracefully");
  void gameServer.gracefullyShutdown();
});

process.on("SIGINT", () => {
  console.log("[server] SIGINT received, shutting down gracefully");
  void gameServer.gracefullyShutdown();
});
