import type { Router } from 'express';
import type { BookingReviewContract } from '../bookings/bookings.public.js';
import type { IdentityPublicContract } from '../identity/identity.public.js';
import type { SettingsPublicContract } from '../settings/settings.public.js';
import { MongoReviewRepository } from './infrastructure/reviewRepository.impl.js';
import { RateTripUseCase } from './application/useCases/rateTrip.usecase.js';
import { PublishReviewsUseCase } from './application/useCases/publishReviews.usecase.js';
import {
  makeAdminReviewsControllers,
  makeRateTripController,
} from './interface/reviews.controller.js';
import { buildAdminReviewsRouter, buildAudienceReviewsRouter } from './interface/reviews.routes.js';
import { registerReviewsSwaggerPaths } from './interface/reviews.swagger.js';

export interface ReviewsDependencies {
  /** Read-only. A review needs to know a trip finished and who was on it, and nothing else. */
  bookings: BookingReviewContract;
  identity: IdentityPublicContract;
  settings: SettingsPublicContract;
}

export interface ReviewsContainer {
  buildAdminRouter: () => Router;
  buildAudienceRouter: (role: 'CUSTOMER' | 'DRIVER') => Router;
  /**
   * The worker's sweep. Releases reviews whose blind window has closed and returns how many —
   * see `PublishReviewsUseCase` for why the clock is the only other thing that can publish one.
   */
  processExpiredReviews: () => Promise<number>;
}

export function buildReviewsContainer(deps: ReviewsDependencies): ReviewsContainer {
  registerReviewsSwaggerPaths();

  const repo = new MongoReviewRepository();
  const publish = new PublishReviewsUseCase(repo, deps.identity, deps.settings);
  const rateTrip = new RateTripUseCase(repo, deps.bookings, deps.settings, publish);

  const adminControllers = makeAdminReviewsControllers(repo, deps.identity);

  return {
    buildAdminRouter: () => buildAdminReviewsRouter(adminControllers),
    buildAudienceRouter: (role) =>
      buildAudienceReviewsRouter(role, makeRateTripController(rateTrip, role)),
    processExpiredReviews: () => publish.publishExpired(),
  };
}
