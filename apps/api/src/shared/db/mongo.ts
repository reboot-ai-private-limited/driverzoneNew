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

export function mongoHealth(): { ok: boolean; state: string } {
  const readyState = mongoose.connection.readyState;
  return { ok: readyState === 1, state: CONNECTION_STATES[readyState] ?? 'unknown' };
}
