import type { Router } from 'express';
import type { SettingsPublicContract } from '../settings/settings.public.js';
import { ReviewRepository } from './infrastructure/review.repository.js';
import { RateTripUseCase } from './application/useCases/rateTrip.usecase.js';
import { ProcessExpiredReviewsUseCase } from './application/useCases/processExpiredReviews.usecase.js';
import { makeReviewsControllers } from './interface/reviews.controller.js';
import { buildAdminReviewsRouter, buildAudienceReviewsRouter } from './interface/reviews.routes.js';
import { registerReviewsSwaggerPaths } from './interface/reviews.swagger.js';

export interface ReviewsContainer {
  buildAdminRouter: () => Router;
  buildAudienceRouter: (role: 'CUSTOMER' | 'DRIVER') => Router;
  processExpiredReviews: (submissionWindowHours: number) => Promise<void>;
}

export function buildReviewsContainer(settings: SettingsPublicContract): ReviewsContainer {
  const repo = new ReviewRepository();
  const rateTripUc = new RateTripUseCase(repo, settings);
  const processExpiredUc = new ProcessExpiredReviewsUseCase();

  const controllers = makeReviewsControllers(rateTripUc);

  registerReviewsSwaggerPaths();

  return {
    buildAdminRouter: () => buildAdminReviewsRouter(controllers),
    buildAudienceRouter: (role) => buildAudienceReviewsRouter(role, controllers),
    processExpiredReviews: (hours) => processExpiredUc.execute(hours),
  };
}
