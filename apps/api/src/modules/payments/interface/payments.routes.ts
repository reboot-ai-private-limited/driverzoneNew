import { Router, type RequestHandler } from 'express';
import { rateLimitMiddleware } from '../../../shared/http/rateLimit.middleware.js';

export interface WebhookControllers {
  webhook: RequestHandler;
}

/**
 * Mounted at `/api/payments`, OUTSIDE the `/customer`, `/driver` and `/admin` role routers.
 *
 * The caller is a payment provider's server, which holds no session and belongs to none of the
 * three audiences. It authenticates with a signature over the body instead, which is checked in
 * the controller — so there is deliberately no `requireAuth` on this router.
 *
 * The rate limit is generous rather than tight: a provider legitimately bursts on redelivery
 * after an outage, and throttling that means refusing the events that tell us bookings were
 * paid. It is here to bound a flood, not to shape normal traffic.
 */
export function buildWebhookRouter(handlers: WebhookControllers): Router {
  const router = Router();

  router.post(
    '/webhook',
    rateLimitMiddleware({ windowMs: 60_000, max: 600, prefix: 'payments:webhook' }),
    handlers.webhook,
  );

  return router;
}
