import { Router } from 'express';
import { requireAuth } from '@/shared/http/auth.middleware.js';
import type { ReviewsControllers } from './reviews.controller.js';

export function buildAudienceReviewsRouter(role: 'CUSTOMER' | 'DRIVER', controllers: ReviewsControllers): Router {
  const router = Router();
  router.use(requireAuth(role));

  // The caller is hitting `/customer/bookings/:id/rate` or `/driver/bookings/:id/rate`
  router.post('/bookings/:id/rate', controllers.rateTrip);

  return router;
}

export function buildAdminReviewsRouter(controllers: ReviewsControllers): Router {
  const router = Router();
  router.use(requireAuth('ADMIN'));

  router.get('/', controllers.listAdminReviews);
  router.delete('/:id', controllers.deleteReview);
  router.patch('/:id/flag', controllers.toggleFlagReview);

  return router;
}
