import { Redis } from 'ioredis';
import { env } from '@/config/env.js';
import { logger } from '@/shared/logging/logger.js';

/**
 * The Redis connection shared by BullMQ and the driver-location cache.
 *
 * Created on first use, not at import. A module-scope `new Redis(...)` opens a socket the
 * moment anything in the import graph reaches this file — which means a unit test that imports
 * a use case, for reasons entirely unrelated to Redis, needs a running Redis. The testing
 * story in docs/engineering/10-testing.md ("no database, no Redis, no Express") only survives
 * if importing code stays free of side effects.
 */
let connection: Redis | undefined;

export function getRedis(): Redis {
  if (connection !== undefined) return connection;

  /**
   * `maxRetriesPerRequest: null` is required by BullMQ, not a tuning choice — its blocking
   * commands are long-lived, and ioredis's default retry cap kills them mid-wait. Without this,
   * dispatch workers die quietly a few seconds after they start.
   */
  connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  /**
   * ioredis emits 'error' on every failed reconnect attempt. Without a listener that is an
   * unhandled 'error' event, which Node treats as fatal — so a transient Redis blip would take
   * the whole API down rather than degrading it. Log and let ioredis keep retrying; /api/health
   * reports the state and the load balancer decides.
   */
  connection.on('error', (err: Error) => {
    logger.warn({ message: err.message }, 'redis connection error');
  });

  return connection;
}

/** Closes the connection if one was ever opened. Safe to call when none was. */
export function disconnectRedis(): void {
  connection?.disconnect();
  connection = undefined;
}

/**
 * Same budget and same reasoning as Mongo's probe (`shared/db/mongo.ts`): a health check that
 * can outlast the orchestrator polling it is worse than none.
 */
const PING_TIMEOUT_MS = 2_000;

/**
 * Whether Redis can actually serve a command right now.
 *
 * The race is not belt-and-braces — without it this function NEVER RETURNS when Redis is
 * unreachable. `maxRetriesPerRequest: null` above (required by BullMQ) means a command issued
 * while the connection is down sits in ioredis's offline queue indefinitely rather than
 * rejecting, so `ping()` simply never settles and `/api/health` hangs with it. That turns the
 * one endpoint whose job is to report trouble into another casualty of it.
 */
export async function redisHealth(): Promise<{ ok: boolean; state: string }> {
  const redis = getRedis();
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('ping timed out')), PING_TIMEOUT_MS).unref(),
      ),
    ]);
    return { ok: pong === 'PONG', state: redis.status };
  } catch (err) {
    return { ok: false, state: err instanceof Error ? err.message : redis.status };
  }
}
