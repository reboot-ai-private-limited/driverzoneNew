import { QueryCache, QueryClient } from '@tanstack/react-query';
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
    // One place every failed READ passes through. It stays silent by design: §7 of
    // docs/engineering/frontend-architecture.md — a read renders an error state where the data
    // would have been, and toasting it as well notifies the user about something they are
    // already looking at. What this is for is the request id, which is otherwise only visible
    // to whoever happened to be looking at that panel.
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!(error instanceof ApiError)) return;
        console.error('[query]', query.queryHash, error.code, error.requestId, error.message);
      },
    }),
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
