import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import { env } from '@/config/env.js';
import { errorHandler, notFoundHandler } from '@/shared/http/error-handler.js';
import { buildApiRouter, buildContainers } from './routes.js';

/**
 * Builds the Express app without starting a listener, so tests can drive it through supertest
 * with no port and no teardown.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind nginx: without this, req.ip is the proxy and every rate limit shares one bucket.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', buildApiRouter(buildContainers()));

  // Order matters: 404 catches unmatched routes, then the error handler catches everything
  // forwarded by asyncHandler. Registering these before the routes would swallow all traffic.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
