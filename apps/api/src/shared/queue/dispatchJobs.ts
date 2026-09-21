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
export function jobIdFor(
  kind: 'dispatch' | 'dispatch-early' | 'wave',
  bookingId: string,
  wave?: number,
): string {
  if (kind === 'wave') return `wave-${bookingId}-${wave ?? 1}`;
  return `${kind}-${bookingId}`;
}

/**
 * How far T−90 must be from now before an early ring is worth enqueueing.
 *
 * Without a floor, a booking whose pickup is 91 minutes away would start an early search that is
 * still widening through its waves when the final one is due — the two would overlap, and
 * `attemptFor` would flip mid-search, parking or giving up depending on which side of `dispatchAt`
 * a wave happened to land on. Ten minutes is comfortably longer than a full ladder of waves.
 *
 * The practical effect: a pickup must be about 100 minutes away to be rung for twice. Anything
 * nearer gets the single immediate search it has always had.
 */
const EARLY_RING_MIN_GAP_MS = 10 * 60_000;

/**
 * Ring for a scheduled booking NOW, long before its dispatch window.
 *
 * The first half of docs/LLD/dispatch-and-assignment.md §Ring early, park, ring again. It is a
 * SEPARATE JOB from the one at T−90, with its own id, because both must be able to sit in the
 * queue at once — the deterministic `dispatch-${bookingId}` id would have made the second
 * enqueue silently replace the first.
 *
 * Returns whether anything was enqueued, so the caller can log the distinction rather than guess.
 */
export async function enqueueEarlyDispatch(input: {
  bookingId: string;
  isScheduled: boolean;
  dispatchAt: Date;
}): Promise<boolean> {
  if (!input.isScheduled) return false;
  if (input.dispatchAt.getTime() - Date.now() < EARLY_RING_MIN_GAP_MS) return false;

  await getQueue(QUEUE_NAMES.dispatch).add(
    DISPATCH_JOBS.dispatch,
    { bookingId: input.bookingId, requestId: getRequestId() } satisfies DispatchJobData,
    {
      jobId: jobIdFor('dispatch-early', input.bookingId),
      removeOnComplete: true,
      removeOnFail: 500,
    },
  );

  return true;
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
