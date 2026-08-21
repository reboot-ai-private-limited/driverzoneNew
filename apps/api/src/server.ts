import { createApp } from './app.js';
import { env } from '@/config/env.js';
import { connectMongo, disconnectMongo } from '@/shared/db/mongo.js';
import { redisConnection } from '@/shared/queue/redis.js';
import { logger } from '@/shared/logging/logger.js';

/**
 * The HTTP entrypoint.
 *
 * Dependencies connect BEFORE the listener opens. Binding the port first would accept requests
 * during the window where Mongo is still connecting, and every one of them would fail for a
 * reason that has nothing to do with the request.
 */
async function main(): Promise<void> {
  await connectMongo();

  const server = createApp().listen(env.PORT, () => {
    logger.info(`api listening on :${env.PORT}`, { env: env.NODE_ENV });
  });

  /**
   * Graceful shutdown. `server.close` stops accepting new connections and waits for in-flight
   * requests to finish — without it every deploy cuts live responses mid-flight, which for a
   * driver accepting a trip means an offer that neither succeeded nor failed.
   *
   * The timeout is the backstop: a request wedged on a slow dependency must not hold the
   * process open past the orchestrator's own kill timer, or SIGTERM becomes SIGKILL and the
   * draining was pointless.
   */
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, draining`);
    const force = setTimeout(() => {
      logger.error('drain timed out, forcing exit');
      process.exit(1);
    }, 15_000);
    force.unref();

    server.close(() => {
      void (async () => {
        await disconnectMongo();
        redisConnection.disconnect();
        logger.info('shutdown complete');
        process.exit(0);
      })();
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.error('failed to start', { err: String(err) });
  process.exit(1);
});
