import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../../../shared/http/auth.middleware.js';

export interface AdminControllers {
  driverWallet: RequestHandler;
}

/**
 * Mounted at `/api/admin/drivers`, after identity's `/admin` router.
 *
 * The wallet read lives HERE rather than in `identity`, where the route was first stubbed, because
 * `identity` is tier 1 and `ledger` is tier 2 — identity cannot import this module's contract, not
 * even as a type, and the composition root passing it in would be the tier inversion `container.ts`
 * explicitly says means the tiers are wrong. The module that owns the rows owns the query.
 *
 * `/admin/drivers/:id/wallet` reaches this by the same prefix fall-through `/admin/zones` uses:
 * identity's admin router has no route matching three segments after `/drivers`, so it calls
 * `next()` and the request arrives here. Payouts will mount alongside it when they land.
 */
export function buildAdminRouter(handlers: AdminControllers): Router {
  const router = Router();
  router.use(requireAuth('ADMIN'));

  router.get('/:id/wallet', handlers.driverWallet);

  return router;
}
