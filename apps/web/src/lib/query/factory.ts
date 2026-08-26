import { keepPreviousData, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { withAuth } from '../auth/session';
import { staleTime } from './keys';

/**
 * How every authenticated read in the panel is built. A feature hook supplies a key and a call;
 * everything below is decided once, here.
 *
 * There are three things a hand-written `useQuery` gets wrong, and the third is not obvious:
 *
 *   1. It forgets `withAuth`. The 401 then lands in `shouldRetry`, which correctly refuses to
 *      retry a 4xx — so the screen renders "unauthenticated" for an admin whose session is
 *      valid and one refresh away. Silent, and it looks like an auth bug rather than a missing
 *      wrapper.
 *   2. It drops the `signal`. TanStack hands one to every `queryFn`; ignoring it leaves
 *      superseded requests running and their answers racing.
 *   3. It omits `keepPreviousData`, so the table empties on every filter change
 *      (docs/engineering/frontend-architecture.md §4).
 */

export interface AuthedQueryInput<T> {
  queryKey: QueryKey;
  /**
   * The endpoint call. Receives the access token and the abort signal for THIS attempt —
   * forward the signal, or a request the user has already navigated away from keeps running.
   */
  fetch: (token: string, signal: AbortSignal) => Promise<T>;
  /** Defaults to `staleTime.configuration`. Pick from `staleTime`, never a bare number. */
  staleTime?: number;
  enabled?: boolean;
  refetchOnWindowFocus?: boolean;
}

type AuthedQueryOptions<T> = Pick<
  UseQueryOptions<T, Error, T, QueryKey>,
  'queryKey' | 'queryFn' | 'staleTime' | 'enabled' | 'refetchOnWindowFocus' | 'placeholderData'
>;

export function authedQueryOptions<T>({
  queryKey,
  fetch,
  staleTime: freshFor = staleTime.configuration,
  enabled,
  refetchOnWindowFocus,
}: AuthedQueryInput<T>): AuthedQueryOptions<T> {
  return {
    queryKey,
    // `withAuth` supplies the token and, on a 401, refreshes ONCE and replays — sharing that
    // refresh with every other query in flight. Six independent refreshes would present five
    // spent rotation tokens, and the API treats a replayed one as theft: session family revoked.
    queryFn: ({ signal }) => withAuth((token) => fetch(token, signal)),
    staleTime: freshFor,
    // A filter change makes a new key, and a new key has no data. Without this the table blanks
    // and refills on every keystroke; with it the previous rows stay put under a progress bar.
    placeholderData: keepPreviousData,
    ...(enabled === undefined ? {} : { enabled }),
    ...(refetchOnWindowFocus === undefined ? {} : { refetchOnWindowFocus }),
  };
}

/**
 * The same thing for live operational data — bookings, dispatch, driver positions — which has no
 * useful stale window and must keep arriving without anyone touching the page.
 *
 * `refetchIntervalInBackground` is left at its default of `false` on purpose. A hidden tab stops
 * polling entirely, and an ops laptop with the panel open on a second monitor overnight is
 * otherwise several thousand pointless requests before anyone reads one of them.
 */
export function liveQueryOptions<T>(
  input: Omit<AuthedQueryInput<T>, 'staleTime'> & { refetchIntervalMs: number },
): AuthedQueryOptions<T> & { refetchInterval: number } {
  const { refetchIntervalMs, ...rest } = input;
  return {
    ...authedQueryOptions({ ...rest, staleTime: staleTime.live }),
    refetchInterval: refetchIntervalMs,
  };
}
