import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import { env } from '@/config/env.js';
import { errorHandler, notFoundHandler } from '@/shared/http/error-handler.js';
import { accessLogMiddleware } from '@/shared/http/access-log.middleware.js';
import { requestIdMiddleware } from '@/shared/http/request-id.middleware.js';
import { shouldCaptureRawBody } from '@/shared/http/rawBody.js';
import { buildContainers } from './container.js';
import { buildApiRouter } from './routes.js';

/**
 * Builds the Express app without starting a listener, so tests can drive it through supertest
 * with no port and no teardown.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind nginx: without this, req.ip is the proxy and every rate limit shares one bucket.
  app.set('trust proxy', 1);

  // FIRST, ahead of helmet and cors: a request rejected by either still gets an ID, and a
  // rejection you cannot correlate with a log line is the one you most need to.
  app.use(requestIdMiddleware());
  // After the ID, so the access line and every application line from this request share it.
  app.use(accessLogMiddleware());

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  /*
   * `verify` runs with the raw buffer before it is parsed, which is the only place the exact
   * bytes a payment provider signed are still available — reserialising the parsed object does
   * not reproduce them. Kept for the webhook routes alone (`shouldCaptureRawBody`), so ordinary
   * traffic does not carry a second copy of every body.
   */
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        if (shouldCaptureRawBody(req.url)) {
          (req as express.Request).rawBody = buf.toString('utf8');
        }
      },
    }),
  );
  // The admin panel's refresh token travels as an httpOnly cookie; the mobile apps never send
  // one. Unsigned, deliberately — the value is a JWT that already carries its own signature,
  // and a second one would be a second secret to rotate for no additional guarantee.
  app.use(cookieParser());

  app.use('/api', buildApiRouter(buildContainers()));

  // Order matters: 404 catches unmatched routes, then the error handler catches everything
  // forwarded by asyncHandler. Registering these before the routes would swallow all traffic.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
