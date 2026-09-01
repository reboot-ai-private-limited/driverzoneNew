/**
 * DOMAIN — what the reviews module needs from storage, and the shapes it works in.
 *
 * A review is plain data by the time it reaches a use case: string ids, a `Date`, no live
 * document. That is what lets the publishing rules and the rolling average be tested against a
 * hand-built array (docs/engineering/module-anatomy.md).
 */

export interface Review {
  id: string;
  bookingId: string;
  reviewerId: string;
  reviewerRole: 'CUSTOMER' | 'DRIVER';
  revieweeId: string;
  revieweeRole: 'CUSTOMER' | 'DRIVER';
  rating: number;
  tags: string[];
  comment: string | null;
  /** False while the review is BLIND — stored, but counting toward nobody's average. */
  isPublished: boolean;
  adminFlagged: boolean;
  createdAt: Date;
}

export type NewReview = Omit<Review, 'id' | 'isPublished' | 'createdAt'>;

export interface AdminReviewFilter {
  revieweeRole?: 'CUSTOMER' | 'DRIVER' | undefined;
  revieweeId?: string | undefined;
  bookingId?: string | undefined;
  ratingLte?: number | undefined;
  flaggedOnly?: boolean | undefined;
}

export interface ReviewRepositoryPort {
  /**
   * Writes a review, always unpublished.
   *
   * REJECTS a second review for the same booking by the same reviewer at the storage layer, and
   * the use case relies on that rather than only on its own read-first check — two concurrent
   * requests both read "not yet rated" before either writes.
   */
  createReview(data: NewReview): Promise<Review>;

  getReviewByBookingAndReviewer(bookingId: string, reviewerId: string): Promise<Review | null>;
  countReviewsForBooking(bookingId: string): Promise<number>;

  /** Publishes both sides of one booking. Returns the reviewees whose average is now stale. */
  markReviewsPublished(bookingId: string): Promise<string[]>;

  /** The sweep's half: everything still blind past the deadline. Same return. */
  publishUnreleasedBefore(cutoff: Date): Promise<string[]>;

  /** The rolling window the cached average is computed over. Newest first. */
  recentPublishedFor(revieweeId: string, limit: number): Promise<Review[]>;

  listForAdmin(filter: AdminReviewFilter, limit: number): Promise<Review[]>;
  deleteById(id: string): Promise<boolean>;
  /** Returns the new flag state, or null if there is no such review. */
  toggleFlag(id: string): Promise<boolean | null>;
}
