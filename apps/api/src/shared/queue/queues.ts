import { Queue } from 'bullmq';
import { redisConnection } from './redis.js';

/**
 * Durable job queues.
 *
 * Dispatch timing lives here rather than in `setTimeout` for one reason, and it is the single
 * most important operational decision in this codebase: an in-memory timer dies on deploy. The
 * booking it was tracking then sits in SEARCHING forever — no driver, no error, no alert,
 * because nothing failed. A customer watches a spinner while the system believes it is working.
 *
 * BullMQ persists to Redis, survives restarts, retries, and is inspectable when something goes
 * wrong. See docs/LLD/06-dispatch-and-assignment.md §Non-negotiable.
 */
export const QUEUE_NAMES = {
  dispatch: 'dispatch',
  notifications: 'notifications',
} as const;

export const dispatchQueue = new Queue(QUEUE_NAMES.dispatch, { connection: redisConnection });
export const notificationsQueue = new Queue(QUEUE_NAMES.notifications, {
  connection: redisConnection,
});

export const allQueues = [dispatchQueue, notificationsQueue];
