import { Queue } from 'bullmq';
import { getRedis } from './redis.js';

/**
 * Durable job queues.
 *
 * Dispatch timing lives here rather than in `setTimeout` for one reason, and it is the single
 * most important operational decision in this codebase: an in-memory timer dies on deploy. The
 * booking it was tracking then sits in SEARCHING forever — no driver, no error, no alert,
 * because nothing failed. A customer watches a spinner while the system believes it is working.
 *
 * BullMQ persists to Redis, survives restarts, retries, and is inspectable when something goes
 * wrong. See docs/LLD/dispatch-and-assignment.md §Non-negotiable.
 *
 * Constructed on first use rather than at import, for the same reason as the Redis connection
 * itself — a `new Queue(...)` at module scope connects, so importing anything downstream of
 * this file would require a live Redis.
 */
export const QUEUE_NAMES = {
  dispatch: 'dispatch',
  notifications: 'notifications',
  sweeper: 'sweeper',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (queue === undefined) {
    queue = new Queue(name, { connection: getRedis() });
    queues.set(name, queue);
  }
  return queue;
}

/** Closes every queue that was actually opened. Part of graceful shutdown. */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
