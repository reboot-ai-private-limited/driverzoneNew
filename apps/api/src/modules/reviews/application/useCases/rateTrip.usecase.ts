import { z } from 'zod';
import type { ReviewRepository } from '../../infrastructure/review.repository.js';
import type { SettingsPublicContract } from '../../../settings/settings.public.js';

export const RateTripInput = z.object({
  rating: z.number().int().min(1).max(5),
  tags: z.array(z.string()).default([]),
  comment: z.string().max(500).optional(),
});
export type RateTripInput = z.infer<typeof RateTripInput>;

export class RateTripUseCase {
  constructor(
    private readonly repo: ReviewRepository,
    private readonly _settings: SettingsPublicContract,
  ) {}

  async execute(
    bookingId: string,
    reviewerId: string,
    reviewerRole: 'CUSTOMER' | 'DRIVER',
    revieweeId: string,
    input: RateTripInput
  ) {
    // 1. Ensure user hasn't already rated this booking
    const existing = await this.repo.getReviewByBookingAndReviewer(bookingId, reviewerId);
    if (existing) {
      const err = new Error('Already rated this trip');
      (err as any).statusCode = 409;
      throw err;
    }

    // (In a full implementation, we'd also check if Date.now() < booking.completedAt + submission_window_hours
    // but we'll assume the controller or this use-case has access to the booking. For now, we proceed).

    const revieweeRole = reviewerRole === 'CUSTOMER' ? 'DRIVER' : 'CUSTOMER';
    const adminFlagged = input.rating <= 2; // Flag poor reviews for ops

    const reviewData: any = {
      bookingId: bookingId as any,
      reviewerId: reviewerId as any,
      reviewerRole,
      revieweeId: revieweeId as any,
      revieweeRole,
      rating: input.rating,
      tags: input.tags,
      isPublished: false,
      adminFlagged,
    };
    if (input.comment) reviewData.comment = input.comment;

    const review = await this.repo.createReview(reviewData);

    // 2. Check if both sides have now reviewed
    const reviewCount = await this.repo.countReviewsForBooking(bookingId);
    if (reviewCount >= 2) {
      await this.repo.markReviewsPublished(bookingId);
      // We would recompute averages here. For MVP, we skip the immediate recompute or emit an event.
    }

    return { id: review._id.toString(), rating: review.rating };
  }
}
