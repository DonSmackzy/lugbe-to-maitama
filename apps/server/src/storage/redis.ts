// =============================================================================
// Redis Storage & Crash Recovery
// Live presence, rate-limiting, and room state snapshots for crash recovery.
// =============================================================================

import { Redis } from "ioredis";

let _redis: Redis | null = null;

export function getRedisClient(): Redis {
  if (_redis) return _redis;

  const url = process.env["REDIS_URL"] ?? "redis://:ltm_redis_secret@localhost:6379";
  _redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null; // Stop retrying after 5 attempts in offline environments
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  _redis.on("error", (err) => {
    console.warn("[redis] Redis connection warning (running in degraded offline/dev mode):", err.message);
  });

  // Attempt async connection without blocking module initialization
  _redis.connect().catch((err) => {
    console.warn("[redis] Redis not currently reachable:", err.message);
  });

  return _redis;
}

export type RoomSnapshot = {
  roomId: string;
  packId: string;
  tick: number;
  day: number;
  timestamp: number;
  actors: Array<{
    id: string;
    accountId: string;
    balanceKobo: number;
    socialCapital: number;
    energy: number;
    position: { x: number; y: number };
    inventory: [string, number][];
  }>;
};

/**
 * Persists an authoritative room snapshot to Redis with TTL.
 */
export async function saveRoomSnapshot(
  roomId: string,
  snapshot: RoomSnapshot,
  ttlSeconds = 86400
): Promise<void> {
  const client = getRedisClient();
  const key = `rooms:${roomId}:snapshot`;
  try {
    if (client.status === "ready") {
      await client.set(key, JSON.stringify(snapshot), "EX", ttlSeconds);
    }
  } catch (err) {
    console.warn(`[redis] Failed to save snapshot for room ${roomId}:`, (err as Error).message);
  }
}

/**
 * Retrieves a room snapshot for crash recovery.
 */
export async function getRoomSnapshot(roomId: string): Promise<RoomSnapshot | null> {
  const client = getRedisClient();
  const key = `rooms:${roomId}:snapshot`;
  try {
    if (client.status === "ready") {
      const raw = await client.get(key);
      if (raw) return JSON.parse(raw) as RoomSnapshot;
    }
  } catch (err) {
    console.warn(`[redis] Failed to load snapshot for room ${roomId}:`, (err as Error).message);
  }
  return null;
}

/**
 * Deletes a snapshot when a room gracefully terminates.
 */
export async function deleteRoomSnapshot(roomId: string): Promise<void> {
  const client = getRedisClient();
  const key = `rooms:${roomId}:snapshot`;
  try {
    if (client.status === "ready") {
      await client.del(key);
    }
  } catch (err) {
    console.warn(`[redis] Failed to delete snapshot for room ${roomId}:`, (err as Error).message);
  }
}

// In-memory rate-limiter fallback when Redis is offline
const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Checks intent rate limit for an account (sliding 1-second window).
 */
export async function checkRateLimit(
  accountId: string,
  actionKey: string,
  limit = 10,
  windowSec = 1
): Promise<{ allowed: boolean; remaining: number }> {
  const client = getRedisClient();
  const key = `rate:${accountId}:${actionKey}`;

  if (client.status === "ready") {
    try {
      const current = await client.incr(key);
      if (current === 1) {
        await client.expire(key, windowSec);
      }
      return {
        allowed: current <= limit,
        remaining: Math.max(0, limit - current),
      };
    } catch {
      // Fall through to in-memory check
    }
  }

  // Memory fallback
  const now = Date.now();
  const bucketKey = `${accountId}:${actionKey}`;
  const bucket = memoryBuckets.get(bucketKey);

  if (!bucket || now >= bucket.resetAt) {
    memoryBuckets.set(bucketKey, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true, remaining: limit - 1 };
  }

  bucket.count++;
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
  };
}
