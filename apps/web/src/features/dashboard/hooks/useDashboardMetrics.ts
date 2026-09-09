'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  AdminBookingListDto,
  AdminDriverListDto,
  AdminLiveDriversResponse,
  AdminReviewDto,
} from '@driverzone/contracts';
import { request } from '@/lib/api/client';
import { bookingsApi, statusParam } from '@/lib/api/endpoints/bookings';
import { financeApi } from '@/lib/api/endpoints/finance';
import { authedQueryOptions, liveQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';
import { istDateKey } from '@/lib/format';
import { STATUS_GROUPS } from '@/features/bookings/lib/status';

/**
 * The landing screen's numbers.
 *
 * EVERY FIGURE COMES FROM AN ENDPOINT THAT ALREADY EXISTS. Nothing here needed a new route, a new
 * aggregation or a `/dashboard/summary` of its own, and that constraint is why the tiles are the
 * ones they are: it is what makes this shippable rather than a design waiting on the API.
 *
 * **Counting is `limit: 1` plus `pagination.total_items`.** Every admin list already returns the
 * total for the filter it was given, so one row is fetched to learn a number that describes
 * thousands. A tile that pulled a full page to call `.length` on it would be both slower and
 * wrong past the page cap.
 *
 * Queries are grouped by how often they should be re-read, not by which screen they feed — a
 * dashboard's whole behaviour is its staleness. See each `staleTime` below.
 */

/** The one rating that means "somebody should look at this". Matches the server's own threshold. */
const LOW_RATING_THRESHOLD = 2;

/** Enough rows to see the shape of the day without turning the panel into a second bookings list. */
const RECENT_BOOKINGS_LIMIT = 8;

/** A count query never wants rows, but every list endpoint returns some. Ask for the fewest. */
const COUNT_ONLY = 1;

export interface BookingCountsToday {
  total: number;
  completed: number;
  cancelled: number;
  ongoing: number;
  noDriver: number;
}

/**
 * Today's booking counts, and what is in flight right now.
 *
 * FIVE REQUESTS, ONE CACHE ENTRY. They are issued together and awaited as a group, so the row of
 * tiles has a single loading state and appears at once — five separate queries would pop in
 * one at a time, which reads as the page struggling rather than loading.
 *
 * The day is part of the key so the numbers roll over at IST midnight on their own, without a
 * timer: `istDateKey` changes, the key changes, React Query refetches.
 *
 * Statuses come from `STATUS_GROUPS`, never spelled out here. The list screen already owns that
 * mapping and a second copy would drift — `DRIVER_EN_ROUTE` is exactly the kind of name a tile
 * gets subtly wrong while still returning a plausible-looking number.
 */
export function useBookingCountsToday() {
  const day = istDateKey();

  return useQuery(
    authedQueryOptions({
      queryKey: keys.dashboard.bookingCounts(day),
      fetch: async (token, signal): Promise<BookingCountsToday> => {
        const today = { from: day, to: day, limit: COUNT_ONLY };

        const countOf = async (status?: string): Promise<number> => {
          const page: AdminBookingListDto = await bookingsApi.list(
            token,
            { ...today, ...(status === undefined ? {} : { status }) },
            signal
          );
          return page.pagination.total_items;
        };

        /*
         * ONGOING IS NOT SCOPED TO TODAY — it is the only figure here that is not.
         *
         * "Trips in flight" asks what is happening now, and a trip that began before midnight is
         * still in flight at 00:30. Filtering it to today would empty the tile every night while
         * drivers were mid-journey, which is precisely when someone is watching it.
         */
        const [total, completed, cancelled, noDriver, ongoing] = await Promise.all([
          countOf(),
          countOf(statusParam(STATUS_GROUPS.COMPLETED)),
          countOf(statusParam(STATUS_GROUPS.CANCELLED)),
          countOf(statusParam(STATUS_GROUPS.NO_DRIVER)),
          bookingsApi
            .list(token, { status: statusParam(STATUS_GROUPS.ONGOING), limit: COUNT_ONLY }, signal)
            .then((page) => page.pagination.total_items),
        ]);

        return { total, completed, cancelled, ongoing, noDriver };
      },
      // A booking count is the definition of live: it is the number somebody refreshes to watch.
      staleTime: staleTime.live,
    })
  );
}

/**
 * Matched to the driver app's own flush interval (`apps/driver/src/duty/locationPings.ts`).
 *
 * Polling faster buys nothing — there is no newer position to fetch, because the handsets have
 * not sent one. It would just be requests answered with the same rows.
 */
const LIVE_REFETCH_MS = 15_000;

/**
 * How far back a position may be and still be worth drawing.
 *
 * Matches `STALE_PRESENCE_MINUTES` in `apps/api/src/worker.ts` — the system's own answer to "has
 * this handset gone for good". Past it the presence sweep takes the driver off duty anyway, so
 * they would drop out of a `duty_only` query on their own; asking for more would only widen the
 * scan to fetch rows that are about to disappear.
 *
 * It is deliberately WIDER than dispatch's own two-minute window, which is what the map's grey
 * markers live in: between two and fifteen minutes a driver is on duty with an app that has gone
 * quiet, and that gap is the single most useful thing this map shows.
 */
const LIVE_MAX_AGE_MINUTES = 15;

/**
 * Every driver reporting a position — the on-duty count AND the map's markers.
 *
 * ONE QUERY FOR BOTH. The tile needs `total_active` and the map needs `drivers`, and they are two
 * fields of one response; giving them separate hooks would double the polling for data that
 * arrives together. Whichever renders, both read the same cache entry.
 *
 * `liveQueryOptions` rather than `authedQueryOptions`: a map that only updates when you navigate
 * to it is not live. It stops polling in a hidden tab — see the note there about a panel left open
 * on a second monitor overnight.
 *
 * **BOTH FILTERS ARE LOAD-BEARING, NOT PREFERENCES.** Unfiltered, this endpoint asks Mongo for
 * every driver who has EVER reported a position — `$exists` and `$ne` predicates that no index
 * answers selectively, so a collection scan, unbounded, every fifteen seconds, for every open tab.
 * It would also be useless: a map of everyone who ever pinged is mostly dots for drivers who went
 * home weeks ago.
 *
 * `duty_only` is the half that fixes the cost. `drivers` has a compound index led by `isOnDuty`
 * (`driver.model.ts`), so the filter turns the scan into an index seek. `max_age_minutes` bounds
 * what comes back to drivers who are actually out there.
 *
 * `GET /admin/drivers/live` was built on the `driver-panel-fix` branch and never called by
 * anything. This is its first consumer.
 */
export function useLiveDrivers() {
  return useQuery(
    liveQueryOptions({
      queryKey: keys.dashboard.liveDrivers(),
      fetch: (token, signal) =>
        request<AdminLiveDriversResponse>('/admin/drivers/live', {
          token,
          signal,
          query: { duty_only: 'true', max_age_minutes: LIVE_MAX_AGE_MINUTES },
        }),
      refetchIntervalMs: LIVE_REFETCH_MS,
    })
  );
}

export interface ActionQueues {
  awaitingVerification: number;
  lowRatedReviews: number;
}

/**
 * The two queues a human has to work through: drivers waiting on document review, and ratings
 * low enough to want a look.
 *
 * `directory` staleness rather than `live`. These are worklists measured in hours, and a number
 * that ticks while an admin is reading it invites them to refresh instead of act.
 *
 * The reviews endpoint answers with a bare array rather than a page, so the count is its length.
 * That is fine at the volume a `rating_lte=2` filter returns and would not be if it were not
 * filtered — worth remembering if this ever loses the threshold.
 */
export function useActionQueues() {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.dashboard.queues(),
      fetch: async (token, signal): Promise<ActionQueues> => {
        const [drivers, reviews] = await Promise.all([
          request<AdminDriverListDto>('/admin/drivers', {
            token,
            signal,
            query: { onboarding_status: 'SUBMITTED', is_verified: 'false', limit: COUNT_ONLY },
          }),
          request<AdminReviewDto[]>('/admin/reviews', {
            token,
            signal,
            query: { rating_lte: LOW_RATING_THRESHOLD },
          }),
        ]);

        return {
          awaitingVerification: drivers.pagination.total_items,
          lowRatedReviews: reviews.length,
        };
      },
      staleTime: staleTime.directory,
    })
  );
}

/**
 * Drivers past the negative-balance threshold — the collections queue.
 *
 * ITS OWN QUERY PURELY BECAUSE OF WHAT IT COSTS. `suspended: true` is served by
 * `pageDriverBalances`, which groups the whole `driverEarnings` collection. Bundling it with the
 * cheap counts above would drag them all to its refresh rate; alone, it can have the five-minute
 * window `staleTime.dashboardDebt` explains.
 */
export function useDriversOverDebtLimit() {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.dashboard.debt(),
      fetch: (token, signal) =>
        financeApi.driverBalances(token, { suspended: true, limit: COUNT_ONLY }, signal),
      staleTime: staleTime.dashboardDebt,
    })
  );
}

/** The most recent bookings, newest first — the list under the tiles. */
export function useRecentBookings() {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.dashboard.recentBookings(),
      fetch: (token, signal) =>
        bookingsApi.list(token, { limit: RECENT_BOOKINGS_LIMIT, page: 1 }, signal),
      staleTime: staleTime.live,
    })
  );
}
