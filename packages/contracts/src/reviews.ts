/**
 * Post-trip ratings, as the admin panel reads them.
 *
 * BOTH DIRECTIONS. A customer rates the driver and a driver rates the customer, through the same
 * `POST /{customer,driver}/bookings/:id/rate` mounted once per audience — so a review is described
 * by who wrote it and who it lands on, never by a "driver rating" / "customer rating" split. The
 * reviewer comes from the token and the reviewee from the booking, which is why neither is a field
 * the caller can set.
 */

export type ReviewParty = 'CUSTOMER' | 'DRIVER';

/**
 * `POST /{customer,driver}/bookings/:id/rate`.
 *
 * NOTHING HERE SAYS WHO IS BEING RATED, and that is the point. `RateTripUseCase` takes the
 * reviewer from the token, the reviewee from the booking and the role from the router the request
 * arrived on — so a caller cannot address a review at someone they never travelled with. `tags`
 * are free strings the server stores verbatim; each app owns its own vocabulary, because the two
 * directions are not rating the same things.
 *
 * The server also enforces what the body cannot express: the booking must be COMPLETED, one
 * review per reviewer per booking, and inside `reviews.submission_window_hours`.
 */
export interface RateTripRequest {
  /** 1–5. Two and below is auto-flagged for ops. */
  rating: number;
  tags?: string[] | undefined;
  comment?: string | undefined;
}

export interface RateTripResponse {
  id: string;
  rating: number;
}

/**
 * One row of `GET /admin/reviews`.
 *
 * The API returned this shape untyped (`Promise<unknown[]>`) and the panel declared its own copy
 * of it, so the two were held together by nothing at all. That is exactly how the driver app's
 * profile screen went on sending `vehicle_type_preference` for weeks after the field became
 * `vehicle_type_preferences` — it type-checked on both sides and was wrong in the middle. One
 * shape, imported by both.
 */
export interface AdminReviewDto {
  id: string;
  booking_id: string;

  /** Who wrote it. `name` is resolved by the API; 'Unknown' when the account is gone. */
  reviewer: { id: string; role: ReviewParty; name: string };
  /** Who it is about. The panel's tabs filter on `reviewee.role`. */
  reviewee: { id: string; role: ReviewParty; name: string };

  /** 1–5. One and two star ratings are auto-flagged for ops. */
  rating: number;
  tags: string[];
  comment: string | null;
  created_at: string;

  /**
   * Hidden from public aggregates by an admin, or auto-set for a low rating.
   *
   * A moderation state, NOT a deletion: the row stays, the rating stops counting. Toggling it is
   * the reversible action and `DELETE` is the irreversible one, which is why the panel offers
   * both rather than treating them as the same button.
   */
  admin_flagged: boolean;
}

/**
 * `GET /admin/reviews` query.
 *
 * Every field is optional and they AND together. `rating_lte` and `flagged` are the two the ops
 * queue is actually driven by — "show me what went wrong" — and a panel that fetches everything
 * and filters in the browser cannot answer that beyond the server's page cap.
 */
export interface AdminReviewsQuery {
  reviewee_role?: ReviewParty | undefined;
  reviewee_id?: string | undefined;
  booking_id?: string | undefined;
  /** Ratings at or below this. `2` is the flagging threshold and the useful default. */
  rating_lte?: number | undefined;
  flagged?: boolean | undefined;
}
