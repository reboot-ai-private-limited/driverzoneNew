import { z } from 'zod';
import { AppError } from '@/shared/errors/AppError.js';
import type { Booking, BookingReviewContract } from '../../../bookings/bookings.public.js';
import type { SettingsPublicContract } from '../../../settings/settings.public.js';
import type { ReviewRepositoryPort } from '../../domain/reviewRepository.port.js';
import type { PublishReviewsUseCase } from './publishReviews.usecase.js';

export const RateTripInput = z.object({
  rating: z.number().int().min(1).max(5),
  tags: z.array(z.string()).default([]),
  comment: z.string().max(500).optional(),
});
export type RateTripInput = z.infer<typeof RateTripInput>;

/** A 1- or 2-star review is surfaced to ops rather than waiting for someone to go looking. */
const OPS_ATTENTION_AT_OR_BELOW = 2;

/**
 * The one write path for a review (docs/LLD/reviews.md).
 *
 * Every check below answers a question the caller is NOT trusted on: the reviewer id comes from
 * the token, the reviewee and the deadline come from the booking, and the role comes from the
 * router that mounted the request. Nothing about who is being rated is taken from the body.
 */
export class RateTripUseCase {
  constructor(
    private readonly repo: ReviewRepositoryPort,
    private readonly bookings: BookingReviewContract,
    private readonly settings: SettingsPublicContract,
    private readonly publish: PublishReviewsUseCase,
  ) {}

  async execute(
    bookingId: string,
    reviewerId: string,
    reviewerRole: 'CUSTOMER' | 'DRIVER',
    input: RateTripInput,
  ): Promise<{ id: string; rating: number }> {
    const booking = await this.bookings.findById(bookingId);
    if (booking === null) throw AppError.notFound('That trip does not exist.');

    /*
     * FORBIDDEN rather than NOT FOUND for all three of these, and deliberately with one message.
     *
     * A distinct "this is not your trip" reply turns the endpoint into an oracle: a caller could
     * walk booking ids and learn which ones exist and what state they are in. The caller already
     * knows whether the trip is theirs, so they lose nothing.
     */
    const revieweeId = this.otherParty(booking, reviewerId, reviewerRole);
    if (revieweeId === null) throw AppError.forbidden('That trip cannot be rated.');
    if (booking.status !== 'COMPLETED') throw AppError.forbidden('That trip cannot be rated.');
    if (await this.windowHasClosed(booking)) {
      throw AppError.forbidden('The window for rating this trip has closed.');
    }

    const existing = await this.repo.getReviewByBookingAndReviewer(bookingId, reviewerId);
    if (existing !== null) throw AppError.conflict('You have already rated this trip.');

    const review = await this.create(bookingId, reviewerId, reviewerRole, revieweeId, input);

    /*
     * The second review closes the blind window early — there is nothing left to retaliate
     * against once both sides have committed. If only one side ever rates, the sweep releases it
     * when the window elapses instead.
     */
    if ((await this.repo.countReviewsForBooking(bookingId)) >= 2) {
      await this.publish.publishForBooking(bookingId);
    }

    return { id: review.id, rating: review.rating };
  }

  /**
   * Who the reviewer is rating — or `null` if they were not on this trip.
   *
   * This is the ownership check and the reviewee lookup at once, which is why they cannot drift
   * apart: there is no path that establishes one without the other.
   */
  private otherParty(
    booking: Booking,
    reviewerId: string,
    reviewerRole: 'CUSTOMER' | 'DRIVER',
  ): string | null {
    if (reviewerRole === 'CUSTOMER') {
      if (booking.customerId !== reviewerId) return null;
      return booking.driverId;
    }
    if (booking.driverId !== reviewerId) return null;
    return booking.customerId;
  }

  private async windowHasClosed(booking: Booking): Promise<boolean> {
    // A COMPLETED booking always carries `completedAt`; treat its absence as a closed window
    // rather than an open one, so bad data cannot be rated forever.
    if (booking.completedAt === null) return true;
    const hours = await this.settings.get('reviews.submission_window_hours');
    return Date.now() > booking.completedAt.getTime() + hours * 60 * 60 * 1000;
  }

  private async create(
    bookingId: string,
    reviewerId: string,
    reviewerRole: 'CUSTOMER' | 'DRIVER',
    revieweeId: string,
    input: RateTripInput,
  ): Promise<{ id: string; rating: number }> {
    try {
      return await this.repo.createReview({
        bookingId,
        reviewerId,
        reviewerRole,
        revieweeId,
        revieweeRole: reviewerRole === 'CUSTOMER' ? 'DRIVER' : 'CUSTOMER',
        rating: input.rating,
        tags: input.tags,
        comment: input.comment ?? null,
        adminFlagged: input.rating <= OPS_ATTENTION_AT_OR_BELOW,
      });
    } catch (error) {
      /*
       * The `{bookingId, reviewerId}` unique index, firing. The read above is not enough on its
       * own: a double-tapped submit button issues two requests that both read "not rated yet"
       * before either writes. The index is the real guarantee; this only translates it.
       */
      if (isDuplicateKey(error)) throw AppError.conflict('You have already rated this trip.');
      throw error;
    }
  }
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}
