import { Router } from 'express';
import { requireAuth } from '@/shared/http/auth.middleware.js';
import type { AdminControllers } from './admin.controller.js';

/**
 * INTERFACE — admin profile and driver verification.
 *
 * Every route here is `requireAuth('ADMIN')`, which checks the token's `aud` claim — so a
 * customer or driver token is rejected with 403 even though it is perfectly valid elsewhere.
 *
 * There is no finer-grained permission model yet: v1 has a single flat admin role
 * (docs/LLD/user.md). `admin-panel.md` sketches an `OPS_ADMIN` scope, which is
 * its own decision and deliberately not invented here.
 */
export function buildAdminRouter(controllers: AdminControllers): Router {
  const router = Router();

  router.use(requireAuth('ADMIN'));

  router.get('/profile', controllers.getProfile);
  router.patch('/profile', controllers.updateProfile);

  // Customers are read and edited here, never created: an account comes into existence only when
  // somebody verifies an OTP with their own phone. There is deliberately no POST.
  router.get('/customers', controllers.listCustomers);
  router.get('/customers/:id', controllers.getCustomerDetails);
  router.patch('/customers/:id', controllers.updateCustomer);

  router.get('/drivers', controllers.listDrivers);
  router.get('/drivers/:id', controllers.getDriverDetails);
  router.get('/drivers/:id/wallet', controllers.getDriverWallet);
  router.get('/drivers/:id/duty-history', controllers.getDriverDutyHistory);

  router.post('/drivers/:id/approve', controllers.approveDriver);
  router.post('/drivers/:id/reject', controllers.rejectDriver);
  router.patch('/drivers/:id/documents/:docId', controllers.reviewDocument);

  return router;
}
