import type { ListBookingsQuery, ListBookingsResponse } from '@driverzone/contracts';
import { infiniteQueryOptions } from '@tanstack/react-query';
import { listBookings } from '@/lib/api/endpoints/bookings';
import { keys } from '@/lib/query/keys';
import { periodWindow, type RideStatus } from './rideHistory';

/**
 * The paged ride-history query — one definition shared by the Rides screen and the tab layout's
 * prefetch, so the prefetched first page lands under exactly the key the screen reads.
 */

/** Rows per page: about two screenfuls, so the next page is asked for well before the end. */
export const HISTORY_PAGE_SIZE = 20;

export type RideHistoryFilter = 'TODAY' | 'THIS_MONTH' | RideStatus;
export type RideHistorySortOrder = NonNullable<ListBookingsQuery['sort']>;

/** What the screen is showing — every input that changes which rows the server returns. */
export interface RideHistoryView {
  filter: RideHistoryFilter | null;
  /** Already trimmed and debounced. */
  search: string;
  sort: RideHistorySortOrder;
}

export const DEFAULT_HISTORY_VIEW: RideHistoryView = { filter: null, search: '', sort: 'NEWEST' };

function toQuery(view: RideHistoryView, cursor: string | null): ListBookingsQuery {
  const query: ListBookingsQuery = { limit: HISTORY_PAGE_SIZE, sort: view.sort };
  if (cursor !== null) query.cursor = cursor;
  if (view.search !== '') query.q = view.search;
  if (view.filter === 'TODAY' || view.filter === 'THIS_MONTH') {
    // The window is computed when the page is fetched, so a refetch after midnight asks for the
    // new day rather than the one the screen was opened on.
    Object.assign(query, periodWindow(view.filter));
  } else if (view.filter !== null) {
    query.group = view.filter;
  }
  return query;
}

export function rideHistoryQuery(view: RideHistoryView) {
  return infiniteQueryOptions({
    queryKey: keys.bookings.history(view),
    queryFn: ({ pageParam }): Promise<ListBookingsResponse> => listBookings(toQuery(view, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
}
