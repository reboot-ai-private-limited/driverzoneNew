import { QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from '../api/ApiError';
import { staleTime } from './keys';

/**
 * NEVER RETRY A 4xx. A retried `VALIDATION_FAILED` is three identical failures and a slower
 * error message; a retried `FORBIDDEN` is three chances to be told no.
 *
 * 401 does not reach here at all — `withAuth` in the session layer refreshes and replays once,
 * which is the only place that can share one refresh across concurrent queries.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError) return error.isRetryable;
  return false;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: staleTime.configuration,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        // On by default and correct for configuration data: a second admin editing zones is
        // exactly who you want to see when you come back to the tab. Screens that should not
        // do this (a form mid-edit) opt out individually.
        refetchOnWindowFocus: true,
      },
      // Mutations are user-initiated and often not idempotent — a retried POST can create two
      // of something. The user can press the button again.
      mutations: { retry: false },
    },
  });
}
