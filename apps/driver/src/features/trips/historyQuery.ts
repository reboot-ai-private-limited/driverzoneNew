import type { ListDriverTripsQuery, ListDriverTripsResponse } from '@driverzone/contracts';
import { infiniteQueryOptions } from '@tanstack/react-query';
import { listTrips } from '@/lib/api/endpoints/trip';
import { keys } from '@/lib/query/keys';
import type { TripStatus } from './tripHistory';

/**
 * The paged trip-history query — one definition shared by the Trips screen and the tab layout's
 * prefetch, so the prefetched first page lands under exactly the key the screen reads.
 */

/** Rows per page: about two screenfuls, so the next page is asked for well before the end. */
export const TRIPS_PAGE_SIZE = 20;

export type TripHistoryFilter = 'TODAY' | 'THIS_MONTH' | TripStatus;

/** What the screen is showing — every input that changes which rows the server returns. */
export interface TripHistoryView {
  filter: TripHistoryFilter | null;
  /** Already trimmed and debounced. */
  search: string;
}

export const DEFAULT_TRIPS_VIEW: TripHistoryView = { filter: null, search: '' };

/**
 * "Today" and "This month" as the instants the server filters on — the start of the driver's local
 * day or month and the start of the next one. Computed here because the server does not know the
 * phone's timezone, and an IST driver's "today" begins at 18:30 UTC the evening before.
 */
export function periodWindow(
  period: 'TODAY' | 'THIS_MONTH',
  now: Date = new Date(),
): { from: string; before: string } {
  const from =
    period === 'TODAY'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : new Date(now.getFullYear(), now.getMonth(), 1);
  const before =
    period === 'TODAY'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { from: from.toISOString(), before: before.toISOString() };
}

function toQuery(view: TripHistoryView, cursor: string | null): ListDriverTripsQuery {
  const query: ListDriverTripsQuery = { limit: TRIPS_PAGE_SIZE };
  if (cursor !== null) query.cursor = cursor;
  if (view.search !== '') query.q = view.search;
  if (view.filter === 'TODAY' || view.filter === 'THIS_MONTH') {
    // Computed when the page is fetched, so a refetch after midnight asks for the new day.
    Object.assign(query, periodWindow(view.filter));
  } else if (view.filter !== null) {
    query.group = view.filter;
  }
  return query;
}

export function tripHistoryQuery(view: TripHistoryView) {
  return infiniteQueryOptions({
    queryKey: keys.trip.history(view),
    queryFn: ({ pageParam, signal }): Promise<ListDriverTripsResponse> =>
      listTrips(signal, toQuery(view, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
}
