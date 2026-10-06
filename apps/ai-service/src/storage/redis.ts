// =============================================================================
// Redis Cache Client
// Handles dialogue response caching with 6-hour TTL (21600s).
// =============================================================================

import { Redis } from "ioredis";
import { config } from "../config.js";

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (_redis) return _redis;

  _redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 150, 1000);
    },
  });

  _redis.on("error", (err) => {
    // Graceful degraded mode if Redis container is not running
    console.warn("[ai-service:redis] Warning (offline fallback mode active):", err.message);
  });

  _redis.connect().catch(() => {});

  return _redis;
}

/**
 * Checks Redis for pre-generated dialogue matching the bucketed contextHash.
 */
export async function getCachedDialogue(contextHash: string): Promise<string | null> {
  const client = getRedis();
  if (client.status !== "ready") return null;

  try {
    return await client.get(`cache:dialogue:${contextHash}`);
  } catch {
    return null;
  }
}

/**
 * Caches an LLM generated line for 6 hours (21600 seconds).
 */
export async function setCachedDialogue(
  contextHash: string,
  text: string,
  ttlSeconds = config.cacheTtlSeconds
): Promise<void> {
  const client = getRedis();
  if (client.status !== "ready") return;

  try {
    await client.set(`cache:dialogue:${contextHash}`, text, "EX", ttlSeconds);
  } catch (err) {
    console.warn("[ai-service:redis] Failed to set cache:", (err as Error).message);
  }
}
