// =============================================================================
// AI Service — Entry Point
// Starts the Fastify server on configured port (default 3001).
// =============================================================================

import { buildApp } from "./server.js";
import { config } from "./config.js";

const app = buildApp();

app.listen({ port: config.port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error("[ai-service] Failed to start Fastify server:", err);
    process.exit(1);
  }
  console.log(`[ai-service] Fastify server listening on ${address}`);
  console.log(`[ai-service] Health check available at http://localhost:${config.port}/health`);
});
