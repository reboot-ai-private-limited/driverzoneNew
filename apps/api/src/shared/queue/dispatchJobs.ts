import { getQueue, QUEUE_NAMES } from './queues.js';
import { getRequestId } from '../http/request-context.js';

/**
 * The dispatch queue's job vocabulary, in one place.
 *
 * DETERMINISTIC JOB IDS. `dispatch-<bookingId>` and `wave-<bookingId>-<wave>` mean enqueueing the
 * same job twice is a no-op rather than a double dispatch — which matters because the sweeper
 * deliberately re-enqueues anything it finds waiting, and would otherwise ring every driver twice
 * for a booking whose original job is merely running late.
 *
 * HYPHENS, NOT COLONS. BullMQ rejects a custom job id containing `:` outright — it namespaces its
 * own Redis keys with them — and fails at `add()` time with "Custom Id cannot contain :". The
 * colon-separated form in docs/LLD/dispatch-and-assignment.md cannot work as written; `jobIdFor`
 * below is the one place that spelling is decided.
 *
 * `requestId` rides in the payload so a job traces back to the request that created it, the
 * convention `worker.ts` already follows for the jobs that exist.
 */

export const DISPATCH_JOBS = {
  /** Start looking for a driver. Delayed to `dispatchAt` for a scheduled booking. */
  dispatch: 'dispatch',
  /** A wave's TTL expired: lapse it and widen. */
  waveTimeout: 'wave-timeout',
} as const;

export interface DispatchJobData {
  bookingId: string;
  /** `exactOptionalPropertyTypes` is on, so an absent request id is spelled out rather than implied. */
  requestId?: string | undefined;
}

export interface WaveTimeoutJobData extends DispatchJobData {
  wave: number;
}

/** The single place a dispatch job id is spelled. See the note above on why colons are out. */
export function jobIdFor(kind: 'dispatch' | 'wave', bookingId: string, wave?: number): string {
  return kind === 'wave' ? `wave-${bookingId}-${wave ?? 1}` : `dispatch-${bookingId}`;
}

export async function enqueueDispatch(bookingId: string, dispatchAt: Date): Promise<void> {
  const delay = Math.max(0, dispatchAt.getTime() - Date.now());

  await getQueue(QUEUE_NAMES.dispatch).add(
    DISPATCH_JOBS.dispatch,
    { bookingId, requestId: getRequestId() } satisfies DispatchJobData,
    { jobId: jobIdFor('dispatch', bookingId), delay, removeOnComplete: true, removeOnFail: 500 },
  );
}

export async function enqueueWaveTimeout(input: {
  bookingId: string;
  wave: number;
  delayMs: number;
}): Promise<void> {
  await getQueue(QUEUE_NAMES.dispatch).add(
    DISPATCH_JOBS.waveTimeout,
    {
      bookingId: input.bookingId,
      wave: input.wave,
      requestId: getRequestId(),
    } satisfies WaveTimeoutJobData,
    {
      jobId: jobIdFor('wave', input.bookingId, input.wave),
      delay: input.delayMs,
      removeOnComplete: true,
      removeOnFail: 500,
    },
  );
}
