import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../../../shared/http/auth.middleware.js';

export interface FinanceControllers {
  driverBalances: RequestHandler;
  transactions: RequestHandler;
  customerWallets: RequestHandler;
  settleDriver: RequestHandler;
}

/**
 * Mounted at `/api/admin/finance`.
 *
 * Reaches here by the same prefix fall-through `/admin/zones` and `/admin/drivers/:id/wallet`
 * already rely on: identity's `/admin` role router has no route matching `/finance`, so it calls
 * `next()` and the request arrives at this one.
 */
export function buildFinanceRouter(handlers: FinanceControllers): Router {
  const router = Router();
  router.use(requireAuth('ADMIN'));

  router.get('/driver-balances', handlers.driverBalances);
  router.get('/transactions', handlers.transactions);
  router.get('/customer-wallets', handlers.customerWallets);

  /** The only write here. Requires an `Idempotency-Key`; see the controller. */
  router.post('/drivers/:id/settle', handlers.settleDriver);

  return router;
}
