import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import { loadEnv } from '@/config/env.js';
import { QUEUE_NAMES, closeQueues } from '@/shared/queue/queues.js';
import { DISPATCH_JOBS, enqueueDispatch } from '@/shared/queue/dispatchJobs.js';
import { OTP_JOBS, type OtpDeliveryJobData } from '@/shared/queue/otpDeliveryJobs.js';
import { disconnectRedis, getRedis } from '@/shared/queue/redis.js';
import { connectMongo, disconnectMongo } from '@/shared/db/mongo.js';
import { runWithContext } from '@/shared/http/request-context.js';
import { logger } from '@/shared/logging/logger.js';
import { buildContainers, type AppContainers } from './container.js';

/**
 * The background entrypoint — a SECOND composition root, not a second application.
 *
 * It builds the same modules from the same code and differs only in what it does with them:
 * the HTTP server hands them to routes, this hands them to queue consumers. Shipping both in
 * one image (different CMD) is what keeps them from drifting — see apps/api/Dockerfile.
 *
 * It imports `container.js`, never `routes.js`. Containers expose `buildRouter()` as a function
 * precisely so this process never constructs an Express router it has no listener to serve.
 */

/** How often the sweeper looks for work the queue should already have picked up. */
const SWEEPER_INTERVAL_MS = 60_000;

/** A booking that never got paid for within this is not going to be. */
const ABANDONED_PAYMENT_MINUTES = 30;

/**
 * How long an on-duty driver may report no position before they are taken off duty.
 *
 * DELIBERATELY MUCH WIDER THAN DISPATCH'S OWN WINDOW. `MongoDriverPool` stops offering trips to a
 * driver whose fix is over two minutes old, and that is the right threshold for "can I route a
 * trip to them right now". This is a different question — "has this handset gone for good" — and
 * answering it on a two-minute silence would knock a working driver offline for a tunnel, a lift
 * or a signal dead spot, which is a far worse bug than the one this sweep exists to fix.
 *
 * Fifteen minutes is long enough that only a dead process reaches it, and short enough that a
 * driver is told inside one shift rather than at the end of it. The ping loop flushes every 15
 * seconds, so a healthy handset misses roughly sixty consecutive flushes before qualifying.
 */
const STALE_PRESENCE_MINUTES = 15;

async function main(): Promise<void> {
  loadEnv();

  await connectMongo();

  const containers = buildContainers();

  const dispatchWorker = new Worker(
    QUEUE_NAMES.dispatch,
    async (job) => {
      /**
       * Each job runs in its own correlation scope, so every line it logs carries an ID.
       *
       * Seeded from the ID the enqueuing request travelled under when the job carries one, which
       * is what makes a dispatch wave traceable back to the booking request that started it —
       * across a process boundary and minutes of delay. A fresh ID is the fallback for jobs with
       * no originating request, like the sweeper.
       */
      const payload: unknown = job.data;
      const inherited =
        typeof payload === 'object' && payload !== null && 'requestId' in payload
          ? (payload as { requestId?: unknown }).requestId
          : undefined;

      const requestId = typeof inherited === 'string' && inherited !== '' ? inherited : randomUUID();

      await runWithContext({ requestId }, async () => {
        await handleDispatchJob(containers, job.name, payload);
      });
    },
    { connection: getRedis(), concurrency: 10 },
  );

  dispatchWorker.on('failed', (job, err) => {
    logger.error({ id: job?.id, name: job?.name, err: err.message }, 'dispatch job failed');
  });

  /**
   * THE NOTIFICATIONS QUEUE'S FIRST CONSUMER. `QUEUE_NAMES.notifications` has been declared since
   * the queues module was written and nothing ever read from it — every job in this process went
   * to `dispatch`. It exists now because a sent WhatsApp OTP has to be checked a few seconds
   * later, and that check cannot live on the request that sent it.
   *
   * CONCURRENCY 5, not 10: each job is one outbound HTTP call to a rate-limited status endpoint,
   * and the queue's depth is a handful of logins rather than a dispatch fan-out.
   */
  const notificationsWorker = new Worker(
    QUEUE_NAMES.notifications,
    async (job) => {
      const payload: unknown = job.data;
      const inherited =
        typeof payload === 'object' && payload !== null && 'requestId' in payload
          ? (payload as { requestId?: unknown }).requestId
          : undefined;

      const requestId = typeof inherited === 'string' && inherited !== '' ? inherited : randomUUID();

      await runWithContext({ requestId }, async () => {
        await handleNotificationJob(containers, job.name, payload);
      });
    },
    { connection: getRedis(), concurrency: 5 },
  );

  notificationsWorker.on('failed', (job, err) => {
    logger.error({ id: job?.id, name: job?.name, err: err.message }, 'notification job failed');
  });

  const sweeper = setInterval(() => {
    void runSweep(containers);
  }, SWEEPER_INTERVAL_MS);

  logger.info({ queues: Object.values(QUEUE_NAMES) }, 'worker started');

  const shutdown = (signal: string) => {
    void (async () => {
      logger.info({ signal }, 'signal received, closing workers');
      clearInterval(sweeper);
      /*
       * BOTH WORKERS, and each waits for its active job. Killing mid-job leaves a booking
       * half-dispatched — or, on the notifications side, a login code whose delivery was checked
       * and whose SMS fallback never went out, which is the one failure the check exists to stop.
       */
      await Promise.all([dispatchWorker.close(), notificationsWorker.close()]);
      await closeQueues();
      await disconnectMongo();
      disconnectRedis();
      process.exit(0);
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function handleDispatchJob(
  containers: AppContainers,
  name: string,
  payload: unknown,
): Promise<void> {
  const data = payload as { bookingId?: unknown; wave?: unknown };
  const bookingId = typeof data.bookingId === 'string' ? data.bookingId : null;

  if (bookingId === null) {
    logger.error({ name }, 'dispatch job with no bookingId — discarding');
    return;
  }

  if (name === DISPATCH_JOBS.dispatch) {
    logger.info({ bookingId }, 'starting dispatch');
    await containers.dispatch.runWave(bookingId);
    return;
  }

  if (name === DISPATCH_JOBS.waveTimeout) {
    const wave = typeof data.wave === 'number' ? data.wave : 1;
    logger.info({ bookingId, wave }, 'wave timed out');
    await containers.dispatch.expireWave(bookingId, wave);
    return;
  }

  logger.warn({ name }, 'unknown dispatch job');
}

/**
 * Did that WhatsApp login code actually arrive — and if not, send an SMS.
 *
 * NOTHING CONFIGURED IS NOT AN ERROR. On a machine with no waagent or no SMS keys
 * `resolveOtpDelivery` is null, and a job that somehow reached this process has nothing to do.
 * Logging it at error level would mean a failure line on every login on a dev box.
 *
 * THE PAYLOAD CARRIES A PLAINTEXT CODE for the seconds it is pending — see
 * `OtpDeliveryJobData.code` for why that trade was taken, and why nothing here logs it.
 */
async function handleNotificationJob(
  containers: AppContainers,
  name: string,
  payload: unknown,
): Promise<void> {
  if (name !== OTP_JOBS.checkDelivery) {
    logger.warn({ name }, 'unknown notification job');
    return;
  }

  const resolve = containers.identity.resolveOtpDelivery;
  if (resolve === null) {
    logger.info('otp delivery check skipped — no whatsapp/sms pair configured');
    return;
  }

  const data = payload as Partial<OtpDeliveryJobData>;
  if (
    typeof data.messageId !== 'string' ||
    typeof data.role !== 'string' ||
    typeof data.phone !== 'string' ||
    typeof data.code !== 'string'
  ) {
    logger.error({ name }, 'otp delivery job with an incomplete payload — discarding');
    return;
  }

  await resolve({
    messageId: data.messageId,
    role: data.role,
    phone: data.phone,
    code: data.code,
  });
}

/**
 * The safety net behind the delayed jobs.
 *
 * Everything the sweeper does is ALREADY meant to have happened: a `dispatch` job was enqueued
 * when the booking was confirmed, and a wave timeout when the wave was rung. It exists because a
 * Redis flush, a failed enqueue or a job that errored past its retries all end the same way — a
 * booking sitting in CONFIRMED forever with nobody looking for it, which is the failure mode
 * `docs/LLD/dispatch-and-assignment.md` opens by naming.
 *
 * Re-enqueueing is safe precisely because the job ids are deterministic: a booking whose original
 * job is merely running late gets the same id and no second dispatch.
 */
async function runSweep(containers: AppContainers): Promise<void> {
  await runWithContext({ requestId: randomUUID() }, async () => {
    try {
      const now = new Date();

      const due = await containers.bookings.contract.findDueForDispatch(now, 100);
      for (const booking of due) {
        logger.warn(
          { bookingId: booking.id, dispatchAt: booking.dispatchAt },
          'booking was due for dispatch and still waiting — re-enqueueing',
        );
        await enqueueDispatch(booking.id, now);
      }

      /*
       * Bookings whose payment never completed. Expired rather than cancelled: nobody cancelled
       * anything, the money simply never arrived, and no cancellation fee applies because there
       * was never a confirmed booking to cancel.
       */
      const cutoff = new Date(now.getTime() - ABANDONED_PAYMENT_MINUTES * 60_000);
      const abandoned = await containers.bookings.sweepAbandonedPayments(cutoff, 100);
      if (abandoned > 0) logger.info({ abandoned }, 'expired bookings that were never paid for');

      /*
       * Reviews whose blind window has closed. Unlike the two above this is not a safety net for
       * a job that failed — nothing was ever scheduled. A review stays unpublished until the
       * OTHER party rates too, and if they never do, only the clock can release it
       * (docs/LLD/reviews.md §Retaliation prevention). The sweep is the clock.
       */
      const published = await containers.reviews.processExpiredReviews();
      if (published > 0) logger.info({ published }, 'published reviews whose window elapsed');

      /*
       * Day-extension requests the driver never answered. Like the reviews above and unlike the
       * two before them, this is not a safety net for a job that failed — nothing was ever
       * scheduled. A request lapses on the clock alone, and the sweep is the clock. Nobody is
       * charged for one that lapses.
       */
      const lapsed = await containers.bookings.expireStaleExtensions(now, 100);
      if (lapsed > 0) logger.info({ lapsed }, 'day extension requests lapsed unanswered');

      /*
       * Drivers whose handset stopped reporting — docs/LLD/driver-app.md S-1.
       *
       * The only failure in this sweep that no amount of client code can prevent: a force-stop, an
       * OEM battery manager or a reboot kills the driver's process without running a line of it,
       * so `isOnDuty` stays true for ever while nothing pings. Dispatch already declines to ring
       * them — `MongoDriverPool` filters on `lastLocationAt` freshness — so no trip is misrouted.
       * The harm is that nobody knows: the driver's app still reads "You're online", the panel
       * still counts them as supply, and the driver waits out a shift that ended when their phone
       * decided it had.
       */
      const stalePresenceCutoff = new Date(now.getTime() - STALE_PRESENCE_MINUTES * 60_000);
      const takenOffline = await containers.identity.sweepStalePresence(stalePresenceCutoff, 200);
      if (takenOffline.length > 0) {
        logger.warn(
          { count: takenOffline.length },
          'drivers were on duty but had stopped reporting location — taken offline',
        );
        /*
         * Told one at a time, and failures are contained per driver: the sweep must finish its
         * batch even if one device token is stale. `sendDutyEnded` already swallows its own
         * transport errors, so this only guards against something unexpected.
         */
        for (const driverId of takenOffline) {
          try {
            await containers.notifications.contract.sendDutyEnded(driverId);
          } catch (error) {
            logger.error({ err: error, driverId }, 'could not tell a driver they went offline');
          }
        }
      }
    } catch (error) {
      // The sweeper must never die. It is the thing that catches everything else failing.
      logger.error({ err: error }, 'sweep failed');
    }
  });
}

main().catch((err: unknown) => {
  logger.fatal({ err: String(err) }, 'worker failed to start');
  process.exit(1);
});
