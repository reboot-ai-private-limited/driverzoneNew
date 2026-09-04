import { useQuery } from '@tanstack/react-query';
import type { AdminReviewDto, AdminReviewsQuery, ReviewParty } from '@driverzone/contracts';
import { request } from '@/lib/api/client';
import { authedQueryOptions } from '@/lib/query/factory';
import { useApiMutation } from '@/lib/query/mutation';

/**
 * `/admin/reviews` — the ops moderation queue.
 *
 * THE ROW TYPE COMES FROM CONTRACTS, not from a copy declared here. This hook used to define its
 * own `Review` while the API returned `unknown[]`, so the two shapes were held together by
 * nothing — the same way the driver app kept sending `vehicle_type_preference` for weeks after
 * the field became plural. Both ends now import `AdminReviewDto`.
 */

export type Review = AdminReviewDto;

/**
 * Filters the SERVER applies, not the browser.
 *
 * `listForAdmin` is capped at 200 rows, so a screen that fetched everything and filtered locally
 * would quietly stop finding old one-star reviews the moment the table outgrew that cap — and
 * "find what went wrong" is the entire job of this screen. Every filter here rides in the query
 * string; only the free-text name search is client-side, because there is no server field for it.
 */
export interface ReviewFilters {
  revieweeRole: ReviewParty;
  /** Ratings at or below this. `2` matches the auto-flagging threshold. */
  ratingLte?: number | undefined;
  flaggedOnly?: boolean | undefined;
}

export function useReviews(filters: ReviewFilters) {
  const { revieweeRole, ratingLte, flaggedOnly } = filters;

  return useQuery(
    authedQueryOptions({
      // Every filter is part of the key, or switching one serves the previous one's rows.
      queryKey: ['admin', 'reviews', { revieweeRole, ratingLte, flaggedOnly }],
      fetch: async (token, signal) => {
        const query: AdminReviewsQuery = { reviewee_role: revieweeRole };
        if (ratingLte !== undefined) query.rating_lte = ratingLte;
        // Only sent when ON. `flagged=false` would mean "show me unflagged ones", which is not
        // what an unticked box is asking for — it is asking for no filter at all.
        if (flaggedOnly === true) query.flagged = true;

        return request<AdminReviewDto[]>('/admin/reviews', {
          token,
          signal,
          query: query as Record<string, string | number | boolean | undefined>,
        });
      },
      /*
       * Short, unlike the five minutes this used to hold. A moderation queue is worked by more
       * than one person at a time, and a row someone else already actioned should not sit there
       * looking untouched for five minutes.
       */
      staleTime: 1000 * 30,
    }),
  );
}

export function useDeleteReview() {
  return useApiMutation<string, { id: string }>({
    call: (token, id) => request(`/admin/reviews/${id}`, { method: 'DELETE', token }),
    invalidates: [['admin', 'reviews']],
    successMessage: 'Review deleted',
  });
}

export function useToggleFlagReview() {
  return useApiMutation<string, { id: string; admin_flagged: boolean }>({
    call: (token, id) => request(`/admin/reviews/${id}/flag`, { method: 'PATCH', token }),
    invalidates: [['admin', 'reviews']],
  });
}
