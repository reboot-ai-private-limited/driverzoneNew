import type { RatingCacheContract } from '../../../identity/identity.public.js';
import type { SettingsPublicContract } from '../../../settings/settings.public.js';
import type { ReviewRepositoryPort } from '../../domain/reviewRepository.port.js';

/**
 * Publishing is what makes a review COUNT — until then it is stored but invisible in either
 * average, which is the whole retaliation guard (docs/LLD/reviews.md §Blind reviews).
 *
 * Exactly two things release a review, and both live here so they cannot diverge:
 *   - the other party rates too, which ends the blindness because both sides have committed
 *   - the submission window elapses, which ends it because nobody else is going to rate
 *
 * The average is then recomputed over the REVIEWEE's last 100 published reviews, not their
 * lifetime — a bad month two years ago should not still be dragging on a driver's score.
 */
const ROLLING_WINDOW = 100;

export class PublishReviewsUseCase {
  constructor(
    private readonly repo: ReviewRepositoryPort,
    private readonly ratings: RatingCacheContract,
    private readonly settings: SettingsPublicContract,
  ) {}

  /** Both sides have now rated. Releases both rows and rescores both people. */
  async publishForBooking(bookingId: string): Promise<void> {
    const revieweeIds = await this.repo.markReviewsPublished(bookingId);
    await this.rescore(revieweeIds);
  }

  /**
   * The sweep, called once a minute from the worker. Returns how many rows it released so a
   * quiet pass logs nothing.
   *
   * Note the window is read from settings on every pass rather than captured at startup: an
   * admin shortening it should take effect on the next sweep, not the next deploy.
   */
  async publishExpired(): Promise<number> {
    const hours = await this.settings.get('reviews.submission_window_hours');
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const revieweeIds = await this.repo.publishUnreleasedBefore(cutoff);
    if (revieweeIds.length === 0) return 0;

    await this.rescore(revieweeIds);
    return revieweeIds.length;
  }

  /**
   * Recomputes each person's cached average from their published reviews.
   *
   * Sequential rather than `Promise.all`: this runs on a background sweep with nothing waiting on
   * it, and a burst of concurrent aggregations is a worse neighbour to the request path than a
   * slow loop is.
   */
  private async rescore(revieweeIds: string[]): Promise<void> {
    for (const revieweeId of new Set(revieweeIds)) {
      const recent = await this.repo.recentPublishedFor(revieweeId, ROLLING_WINDOW);
      if (recent.length === 0) continue;

      const total = recent.reduce((sum, r) => sum + r.rating, 0);
      const role = recent[0]?.revieweeRole;
      if (role === undefined) continue;

      await this.ratings.setRating(role, revieweeId, total / recent.length, recent.length);
    }
  }
}
