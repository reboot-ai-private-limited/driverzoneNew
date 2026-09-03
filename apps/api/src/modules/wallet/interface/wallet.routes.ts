import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../../../shared/http/auth.middleware.js';

export interface CustomerControllers {
  myWallet: RequestHandler;
}

export interface AdminControllers {
  get: RequestHandler;
  grant: RequestHandler;
}

/** Mounted at `/api/customer/wallet`. */
export function buildCustomerRouter(handlers: CustomerControllers): Router {
  const router = Router();
  router.use(requireAuth('CUSTOMER'));

  router.get('/', handlers.myWallet);

  return router;
}

/**
 * Mounted at `/api/admin/customers`, after identity's `/admin` router.
 *
 * Reaches here by the same prefix fall-through `/admin/drivers/:id/wallet` uses: identity's admin
 * router has no route matching `/customers/:id/wallet`, so it calls `next()` and the request
 * arrives at this one. The module that owns the rows owns the query — `identity` is tier 1 and
 * could not import this contract even as a type.
 */
export function buildAdminRouter(handlers: AdminControllers): Router {
  const router = Router();
  router.use(requireAuth('ADMIN'));

  router.get('/:id/wallet', handlers.get);
  router.post('/:id/wallet', handlers.grant);

  return router;
}
