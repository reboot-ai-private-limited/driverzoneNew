import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../../../shared/http/auth.middleware.js';

export interface DriverControllers {
  current: RequestHandler;
  accept: RequestHandler;
  decline: RequestHandler;
}

/**
 * Mounted at `/api/driver/offers`.
 *
 * `/current` is registered before `/:id/…` so it can never be read as an offer id.
 */
export function buildDriverRouter(handlers: DriverControllers): Router {
  const router = Router();
  router.use(requireAuth('DRIVER'));

  router.get('/current', handlers.current);
  router.post('/:id/accept', handlers.accept);
  router.post('/:id/decline', handlers.decline);

  return router;
}
