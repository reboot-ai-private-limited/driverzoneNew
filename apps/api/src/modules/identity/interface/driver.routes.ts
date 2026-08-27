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

  return router;
}
