import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/ApiError';

/**
 * Retry policy, per docs/engineering/frontend-architecture.md §Retries.
 *
 * Never retry a 4xx — a retried `VALIDATION_FAILED` is three identical failures and a slower
 * error message. A `NetworkError` IS worth retrying on a phone, where a request can fail simply
 * because the customer walked into a lift.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (error instanceof ApiError && !error.isRetryable) return false;
          return failureCount < 2;
        },
        staleTime: 30_000,
      },
      // A mutation is a deliberate act the customer is watching. Retrying one automatically can
      // send it twice; anything that creates or moves money carries an Idempotency-Key instead.
      mutations: { retry: false },
    },
  });
}
