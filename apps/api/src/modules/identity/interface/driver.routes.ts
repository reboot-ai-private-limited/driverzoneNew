import { Router } from 'express';
import { requireAuth } from '@/shared/http/auth.middleware.js';
import type { DriverControllers } from './driver.controller.js';

/** INTERFACE — the driver's own account surface. Guarded once, at the router. */
export function buildDriverRouter(controllers: DriverControllers): Router {
  const router = Router();

  router.use(requireAuth('DRIVER'));

  router.get('/profile', controllers.getProfile);
  router.patch('/profile', controllers.updateProfile);
  router.post('/profile/picture-upload-url', controllers.requestProfilePictureUpload);

  router.get('/documents', controllers.listDocuments);
  router.post('/documents', controllers.requestDocumentUpload);

  // No body — the driver is asking to be reviewed, and everything the gate checks is already
  // on their record.
  router.post('/onboarding/submit', controllers.submitOnboarding);

  // Operational, not a profile edit — dispatch reads this flag on every wave.
  router.post('/duty', controllers.setDuty);

  // Batched GPS fixes. What keeps a driver inside the dispatch pool's freshness window.
  router.post('/location', controllers.recordLocation);

  // Where to ring this driver. Idempotent — FCM returns the same token every launch.
  router.post('/devices', controllers.registerDevice);

  return router;
}
