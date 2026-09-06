'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminListBookingsQuery } from '@driverzone/contracts';
import { bookingsApi } from '@/lib/api/endpoints/bookings';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * The booking list.
 *
 * `staleTime.live` — zero — and not `directory`. A booking table is the one screen in this panel
 * where the rows change while somebody is watching them: a trip moves Assigned → En route →
 * Started over the minutes an admin has the page open, and `keys.ts` already names bookings as
 * having "no useful stale window at all".
 */
export function useBookings(query: AdminListBookingsQuery) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.bookings.list(query),
      fetch: (token, signal) => bookingsApi.list(token, query, signal),
      staleTime: staleTime.live,
    }),
  );
}

/**
 * One booking, in full — the details page. `staleTime.live`, for the same reason the list is:
 * a booking can move Assigned → Started while the page is open.
 */
export function useBooking(id: string) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.bookings.detail(id),
      fetch: (token, signal) => bookingsApi.get(token, id, signal),
      staleTime: staleTime.live,
    }),
  );
}

/**
 * One booking's history, for the details page's timeline.
 *
 * `enabled` is why the signature takes `string | undefined` rather than requiring an id: the
 * booking dialog this once served could mount with nothing selected, and a hook that fired
 * anyway would request `/admin/bookings/undefined/events` on every render — the same trap
 * `useCustomer` documents. The details page always has an id from its own route param, but the
 * signature stays permissive so a future caller in the same position does not reintroduce it.
 */
export function useBookingEvents(id: string | undefined) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.bookings.events(id ?? ''),
      fetch: (token, signal) => bookingsApi.events(token, id ?? '', signal),
      staleTime: staleTime.live,
      enabled: id !== undefined,
    }),
  );
}
