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
