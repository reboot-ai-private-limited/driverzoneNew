import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../../../shared/http/auth.middleware.js';

export interface DriverControllers {
  list: RequestHandler;
  accept: RequestHandler;
  decline: RequestHandler;
}

/** Mounted at `/api/driver/offers`. */
export function buildDriverRouter(handlers: DriverControllers): Router {
  const router = Router();
  router.use(requireAuth('DRIVER'));

  router.get('/', handlers.list);
  router.post('/:id/accept', handlers.accept);
  router.post('/:id/decline', handlers.decline);

  return router;
}
