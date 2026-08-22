import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import { loadEnv } from '@/config/env.js';
import { QUEUE_NAMES, closeQueues } from '@/shared/queue/queues.js';
import { disconnectRedis, getRedis } from '@/shared/queue/redis.js';
import { connectMongo, disconnectMongo } from '@/shared/db/mongo.js';
import { runWithContext } from '@/shared/http/request-context.js';
import { logger } from '@/shared/logging/logger.js';
import { buildContainers } from './container.js';

/**
 * The background entrypoint — a SECOND composition root, not a second application.
 *
 * It builds the same modules from the same code and differs only in what it does with them:
 * the HTTP server hands them to routes, this hands them to queue consumers. Shipping both in
 * one image (different CMD) is what keeps them from drifting — see apps/api/Dockerfile.
 *
 * It imports `container.js`, never `routes.js`. Containers expose `buildRouter()` as a function
 * precisely so this process never constructs an Express router it has no listener to serve.
 *
 * This is where dispatch waves, scheduled dispatch and the sweeper will run
 * (docs/LLD/06-dispatch-and-assignment.md).
 */
async function main(): Promise<void> {
  loadEnv();

  await connectMongo();

  const containers = buildContainers();
  // Referenced so the wiring is real rather than decorative — the queue consumers below will
  // call into these contracts as the dispatch and notification modules land.
  logger.debug('containers built', { modules: Object.keys(containers) });

  const dispatchWorker = new Worker(
    QUEUE_NAMES.dispatch,
    async (job) => {
      /**
       * Each job runs in its own correlation scope, so every line it logs carries an ID.
       *
       * Seeded from the ID the enqueuing request travelled under when the job carries one, which
       * is what makes a dispatch wave traceable back to the booking request that started it —
       * across a process boundary and minutes of delay. Producers should put `requestId` in the
       * job payload; a fresh ID is the fallback for jobs with no originating request, like the
       * sweeper.
       */
      const payload: unknown = job.data;
      const inherited =
        typeof payload === 'object' && payload !== null && 'requestId' in payload
          ? (payload as { requestId?: unknown }).requestId
          : undefined;

      const requestId = typeof inherited === 'string' && inherited !== '' ? inherited : randomUUID();

      await runWithContext({ requestId }, async () => {
        logger.info('dispatch job', { name: job.name, id: job.id });
        // Wave timeouts and scheduled dispatch land here in phase 5.
      });
    },
    { connection: getRedis(), concurrency: 10 },
  );

  dispatchWorker.on('failed', (job, err) => {
    logger.error('dispatch job failed', { id: job?.id, name: job?.name, err: err.message });
  });

  logger.info('worker started', { queues: Object.values(QUEUE_NAMES) });

  const shutdown = (signal: string) => {
    void (async () => {
      logger.info(`${signal} received, closing workers`);
      // Waits for the active job to finish. Killing mid-job leaves a booking half-dispatched.
      await dispatchWorker.close();
      await closeQueues();
      await disconnectMongo();
      disconnectRedis();
      process.exit(0);
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.error('worker failed to start', { err: String(err) });
  process.exit(1);
});
