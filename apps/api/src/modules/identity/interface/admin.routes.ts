import { Router, type RequestHandler } from 'express';
import { requireAuth } from '@/shared/http/auth.middleware.js';
import type { AdminControllers } from './admin.controller.js';
import type { AdminRosterControllers } from './adminRoster.controller.js';

/**
 * INTERFACE — admin profile, driver verification, and the admin roster.
 *
 * Every route here is `requireAuth('ADMIN')`, which checks the token's `aud` claim — so a
 * customer or driver token is rejected with 403 even though it is perfectly valid elsewhere.
 *
 * Two roles (docs/decision-log.md, 2026-09-23). Everything below is open to any ADMIN except
 * `/admins`, which additionally needs `requireSuperAdmin` — that guard reads the role from the
 * database per request, so a demotion bites immediately.
 */
export function buildAdminRouter(
  controllers: AdminControllers,
  roster: AdminRosterControllers,
  requireSuperAdmin: RequestHandler,
): Router {
  const router = Router();

  router.use(requireAuth('ADMIN'));

  router.get('/profile', controllers.getProfile);
  router.patch('/profile', controllers.updateProfile);

  /*
   * The roster. Per-route guard rather than `router.use('/admins', …)`: a `use` on a prefix would
   * also run for every request that merely falls THROUGH this router on its way to another module,
   * and those are not this guard's business.
   */
  router.get('/admins', requireSuperAdmin, roster.list);
  router.post('/admins', requireSuperAdmin, roster.create);
  router.patch('/admins/:id', requireSuperAdmin, roster.update);
  router.post('/admins/:id/deactivate', requireSuperAdmin, roster.deactivate);
  router.post('/admins/:id/reactivate', requireSuperAdmin, roster.reactivate);

  // Customers are read and edited here, never created: an account comes into existence only when
  // somebody verifies an OTP with their own phone. There is deliberately no POST.
  router.get('/customers', controllers.listCustomers);
  router.get('/customers/:id', controllers.getCustomerDetails);
  router.patch('/customers/:id', controllers.updateCustomer);

  router.get('/drivers', controllers.listDrivers);
  router.get('/drivers/live', controllers.getLiveDrivers);
  router.get('/drivers/:id', controllers.getDriverDetails);
  router.patch('/drivers/:id', controllers.updateDriver);
  /*
   * `/drivers/:id/wallet` is NOT here. It lives in the `ledger` module, which owns the rows — this
   * router has no route matching it, so the request falls through to the `/admin/drivers` mount in
   * routes.ts. `identity` is tier 1 and cannot see `ledger` at tier 2.
   */
  router.get('/drivers/:id/duty-history', controllers.getDriverDutyHistory);

  router.post('/drivers/:id/approve', controllers.approveDriver);
  router.post('/drivers/:id/reject', controllers.rejectDriver);
  router.patch('/drivers/:id/documents/:docId', controllers.reviewDocument);
  router.patch('/drivers/:id/verify-hill', controllers.verifyHillDriving);
  router.patch('/drivers/:id/suspend', controllers.suspendDriver);

  return router;
}
