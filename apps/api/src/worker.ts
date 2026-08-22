import { Worker } from 'bullmq';
import { QUEUE_NAMES } from '@/shared/queue/queues.js';
import { redisConnection } from '@/shared/queue/redis.js';
import { connectMongo, disconnectMongo } from '@/shared/db/mongo.js';
import { logger } from '@/shared/logging/logger.js';
import { buildContainers } from './routes.js';

/**
 * The background entrypoint — a SECOND composition root, not a second application.
 *
 * It builds the same modules from the same code and differs only in what it does with them:
 * the HTTP server hands them to routes, this hands them to queue consumers. Shipping both in
 * one image (different CMD) is what keeps them from drifting — see apps/api/Dockerfile.
 *
 * This is where dispatch waves, scheduled dispatch and the sweeper will run
 * (docs/LLD/06-dispatch-and-assignment.md).
 */
async function main(): Promise<void> {
  await connectMongo();

  buildContainers();

  const dispatchWorker = new Worker(
    QUEUE_NAMES.dispatch,
    async (job) => {
      logger.info('dispatch job', { name: job.name, id: job.id });
      // Wave timeouts and scheduled dispatch land here in phase 5.
    },
    { connection: redisConnection, concurrency: 10 },
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
      await disconnectMongo();
      redisConnection.disconnect();
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
