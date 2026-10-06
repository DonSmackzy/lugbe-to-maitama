// =============================================================================
// AI Service Configuration
// Environment variables, security keys, timeouts, and cache settings.
// =============================================================================

export const config = {
  port: parseInt(process.env["AI_PORT"] ?? "3001", 10),
  internalApiKey: process.env["INTERNAL_API_KEY"] ?? "ltm_internal_dev_secret",
  redisUrl: process.env["REDIS_URL"] ?? "redis://:ltm_redis_secret@localhost:6379",
  openaiApiKey: process.env["OPENAI_API_KEY"] ?? "",
  openaiBaseUrl: process.env["OPENAI_BASE_URL"] ?? undefined,
  openaiModel: process.env["OPENAI_MODEL"] ?? "gpt-4o-mini",
  /** Strict 1500ms SLA for NPC dialogue generation */
  llmTimeoutMs: parseInt(process.env["AI_TIMEOUT_MS"] ?? "1500", 10),
  /** 6-hour Redis TTL (21600 seconds) */
  cacheTtlSeconds: 21600,
};
