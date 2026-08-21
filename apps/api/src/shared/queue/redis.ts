import { Redis } from 'ioredis';
import { env } from '@/config/env.js';
import { logger } from '@/shared/logging/logger.js';

/**
 * The Redis connection shared by BullMQ and the driver-location cache.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ, not a tuning choice — its blocking
 * commands are long-lived, and ioredis's default retry cap kills them mid-wait. Without this,
 * dispatch workers die quietly a few seconds after they start.
 */
export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

/**
 * ioredis emits 'error' on every failed reconnect attempt. Without a listener that is an
 * unhandled 'error' event, which Node treats as fatal — so a transient Redis blip would take
 * the whole API down rather than degrading it. Log and let ioredis keep retrying; /api/health
 * reports the state and the load balancer decides.
 */
redisConnection.on('error', (err: Error) => {
  logger.warn('redis connection error', { message: err.message });
});

export async function redisHealth(): Promise<{ ok: boolean; state: string }> {
  try {
    const pong = await redisConnection.ping();
    return { ok: pong === 'PONG', state: redisConnection.status };
  } catch {
    return { ok: false, state: redisConnection.status };
  }
}
