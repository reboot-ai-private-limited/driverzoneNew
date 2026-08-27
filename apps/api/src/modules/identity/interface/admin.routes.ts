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

  router.get('/drivers', controllers.listDrivers);
  router.get('/drivers/:id', controllers.getDriverDetails);

  router.post('/drivers/:id/approve', controllers.approveDriver);
  router.post('/drivers/:id/reject', controllers.rejectDriver);
  router.patch('/drivers/:id/documents/:docId', controllers.reviewDocument);

  return router;
}
