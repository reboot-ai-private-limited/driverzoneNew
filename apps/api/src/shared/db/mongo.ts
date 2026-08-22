import mongoose from 'mongoose';
import { env } from '@/config/env.js';
import { logger } from '@/shared/logging/logger.js';

/**
 * The Mongo connection, owned in one place.
 *
 * `strictQuery` on: a filter naming a field that is not in the schema throws instead of
 * silently matching every document. The silent version is how a scoped query loses its scope —
 * a typo in `customerId` returns another tenant's bookings and nothing anywhere reports a
 * problem.
 */
mongoose.set('strictQuery', true);

export async function connectMongo(): Promise<void> {
  await mongoose.connect(env.MONGO_URI, {
    // Fail fast on an unreachable primary rather than queueing requests for 30 s and then
    // timing out every one of them at once.
    serverSelectionTimeoutMS: 5_000,
  });
  logger.info('mongo connected');
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.connection.close();
  logger.info('mongo disconnected');
}

/** Mongoose's readyState is 0-3 plus 99 for "uninitialized" — not a dense range. */
const CONNECTION_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
};

/**
 * Must answer well inside the orchestrator's health interval (15 s in docker-compose.prod.yml).
 * A health check that can hang for longer than the thing polling it is worse than none: the
 * poll times out, the container is marked unhealthy, and the cause is the check itself.
 */
const PING_TIMEOUT_MS = 2_000;

/**
 * Whether Mongo can actually serve a command right now.
 *
 * `readyState` is checked first because it is free and a definitive negative — but it is only a
 * client-side socket flag, and on its own it LIES in the failure that matters most here: a
 * replica set that has lost its primary keeps `readyState === 1` while refusing every write
 * with "not primary". Reporting that as healthy keeps a dead instance in the load balancer.
 *
 * So the state check is a fast path, and the answer comes from a real round trip.
 */
export async function mongoHealth(): Promise<{ ok: boolean; state: string }> {
  const readyState = mongoose.connection.readyState;
  const state = CONNECTION_STATES[readyState] ?? 'unknown';

  if (readyState !== 1) return { ok: false, state };

  const db = mongoose.connection.db;
  if (db === undefined) return { ok: false, state: 'no database handle' };

  try {
    // Races the ping rather than relying on the driver's own timeouts, which are tuned for
    // application queries and are longer than a health check can afford to wait.
    await Promise.race([
      db.admin().ping(),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('ping timed out')), PING_TIMEOUT_MS).unref(),
      ),
    ]);
    return { ok: true, state };
  } catch (err) {
    return { ok: false, state: err instanceof Error ? err.message : state };
  }
}
