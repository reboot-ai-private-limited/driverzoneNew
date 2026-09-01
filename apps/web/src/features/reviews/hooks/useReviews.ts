import { useQuery } from '@tanstack/react-query';
import { request } from '@/lib/api/client';
import { authedQueryOptions } from '@/lib/query/factory';
import { useApiMutation } from '@/lib/query/mutation';

export type Review = {
  id: string;
  booking_id: string;
  reviewer: { id: string; role: 'CUSTOMER' | 'DRIVER'; name: string };
  reviewee: { id: string; role: 'CUSTOMER' | 'DRIVER'; name: string };
  rating: number;
  tags: string[];
  comment: string | null;
  created_at: string;
  admin_flagged: boolean;
};

// Based on how `request` works in client.ts, the payload.data is returned directly.
// The data returned by our controller is an array of reviews.
export type ReviewsResponse = Review[];

export function useReviews(revieweeRole: 'CUSTOMER' | 'DRIVER') {
  return useQuery(
    authedQueryOptions({
      queryKey: ['admin', 'reviews', { revieweeRole }],
      fetch: async (token, signal) => {
        return request<ReviewsResponse>('/admin/reviews', {
          token,
          signal,
          query: { reviewee_role: revieweeRole },
        });
      },
      staleTime: 1000 * 60 * 5, // 5 minutes
    })
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
