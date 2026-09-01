import { Router, type RequestHandler } from 'express';
import { requireAuth } from '@/shared/http/auth.middleware.js';
import type { AdminReviewsControllers } from './reviews.controller.js';

/**
 * Mounted at `/api/customer/bookings` and `/api/driver/bookings`, BEHIND the bookings module's
 * routers for the same prefix — `routes.ts` explains the fall-through. Hence `/:id/rate` rather
 * than `/bookings/:id/rate`.
 */
export function buildAudienceReviewsRouter(
  role: 'CUSTOMER' | 'DRIVER',
  rateTrip: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth(role));

  router.post('/:id/rate', rateTrip);

  return router;
}

/** Mounted at `/api/admin/reviews`. */
export function buildAdminReviewsRouter(controllers: AdminReviewsControllers): Router {
  const router = Router();
  router.use(requireAuth('ADMIN'));

  router.get('/', controllers.listAdminReviews);
  router.delete('/:id', controllers.deleteReview);
  router.patch('/:id/flag', controllers.toggleFlagReview);

  return router;
}
