import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../../../shared/http/auth.middleware.js';
import { rateLimitMiddleware } from '../../../shared/http/rateLimit.middleware.js';

export interface CustomerControllers {
  createQuote: RequestHandler;
}

/**
 * Mounted at `/api/customer/quotes`.
 *
 * Rate limited per customer rather than per IP: quoting runs two zone resolutions, an OSRM route
 * and a settings read, and a whole apartment block behind one NAT is a normal thing that must not
 * be throttled as one caller. The principal exists because `requireAuth` runs first.
 */
export function buildCustomerRouter(handlers: CustomerControllers): Router {
  const router = Router();

  router.use(requireAuth('CUSTOMER'));

  router.post(
    '/',
    rateLimitMiddleware({
      windowMs: 60_000,
      max: 30,
      prefix: 'quotes:create',
      /*
       * Keyed on the customer alone, with NO IP fallback. `requireAuth` above has already run, so
       * a request reaching here always carries a principal — and falling back to `req.ip` would
       * both make express-rate-limit warn about IPv6 prefixes sharing a bucket and reintroduce
       * the per-NAT throttling this key exists to avoid.
       */
      keyBy: (req) => req.principal?.sub ?? 'unauthenticated',
    }),
    handlers.createQuote,
  );

  return router;
}

export interface AdminControllers {
  /** `GET /admin/quotes/explain` — which product a trip resolves to, and why. */
  explainTrip: RequestHandler;
  /** `POST /admin/quotes` — a real quote, for a customer the admin is booking on behalf of. */
  createQuote: RequestHandler;
}

/**
 * Mounted at `/api/admin/quotes`.
 *
 * NO RATE LIMIT, unlike the customer router above. That one exists because quoting is expensive
 * and a whole apartment block sits behind one NAT; this is a handful of admins looking at one
 * trip at a time, and throttling a support tool mid-investigation is the wrong trade.
 */
export function buildAdminRouter(handlers: AdminControllers): Router {
  const router = Router();

  router.use(requireAuth('ADMIN'));
  router.get('/explain', handlers.explainTrip);
  router.post('/', handlers.createQuote);

  return router;
}
