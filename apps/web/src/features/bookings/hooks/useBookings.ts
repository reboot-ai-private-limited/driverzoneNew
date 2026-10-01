'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  AdminCreateBookingRequest,
  AdminCreateBookingResponse,
  AdminCreateCustomerRequest,
  AdminCreateCustomerResponse,
  AdminCreateQuoteRequest,
  AdminListBookingsQuery,
} from '@driverzone/contracts';
import { bookingsApi } from '@/lib/api/endpoints/bookings';
import { customersApi } from '@/lib/api/endpoints/customers';
import { quotesApi, type AdminQuoteResult } from '@/lib/api/endpoints/quotes';
import { authedQueryOptions } from '@/lib/query/factory';
import { useApiMutation } from '@/lib/query/mutation';
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
/**
 * The shortest search worth sending.
 *
 * A single letter matches a large fraction of the directory, so the request is expensive on the
 * server and useless to the admin — nobody picks a driver out of two hundred rows. Two characters
 * is the first length that narrows anything, and it is exported so the dialog can say "keep
 * typing" rather than sit on "Searching…" for a query that will never be sent.
 */
export const DRIVER_SEARCH_MIN_CHARS = 2;

/**
 * The driver picker for a manual transfer.
 *
 * `enabled` on a search of at least `DRIVER_SEARCH_MIN_CHARS`, so opening the dialog does not
 * fetch the whole first page of drivers before the admin has typed anything — and so the query
 * key cannot be `''` forever.
 * `staleTime.directory`: who is verified changes on an ops timescale, not a trip's.
 *
 * `bookingId`, when passed, is what lets the server annotate each row with `vehicle_compatible` —
 * omit it and every row comes back `null` (unknown), same as if it weren't in the query key.
 */
export function useAssignableDrivers(search: string, bookingId?: string) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.bookings.assignableDrivers(search, bookingId),
      fetch: (token, signal) => bookingsApi.assignableDrivers(token, search, bookingId, signal),
      staleTime: staleTime.directory,
      enabled: search.trim().length >= DRIVER_SEARCH_MIN_CHARS,
    }),
  );
}

/**
 * Cancel a booking as an admin. Charges nobody.
 *
 * Invalidates the whole `bookings` subtree rather than the one row: the list is filtered and
 * paged server-side, so a cancelled booking can drop out of the current filter entirely, and the
 * row that goes stale is the one nobody thought about.
 */
export function useCancelBooking() {
  return useApiMutation<{ id: string; reason: string }, unknown>({
    call: (token, { id, reason }) => bookingsApi.cancel(token, id, reason),
    invalidates: [keys.bookings.all()],
    successMessage: 'Booking cancelled. Nobody was charged.',
  });
}

/** Hand a booking to a different driver. Same invalidation reasoning as the cancel above. */
export function useAssignDriver() {
  return useApiMutation<{ id: string; driverId: string; reason?: string }, unknown>({
    call: (token, { id, driverId, reason }) => bookingsApi.assign(token, id, driverId, reason),
    invalidates: [keys.bookings.all()],
    successMessage: 'Driver assigned to the trip.',
  });
}

/**
 * Price a trip for the customer being booked for. A MUTATION rather than a query: each call
 * writes a quote row that expires in ten minutes, and refetching one on window focus would mint a
 * new price behind the admin's back.
 */
export function useAdminQuote() {
  return useApiMutation<AdminCreateQuoteRequest, AdminQuoteResult>({
    call: (token, body) => quotesApi.create(token, body),
  });
}

/** Book the trip. Manual dispatch — see `bookingsApi.create`. */
export function useCreateBooking() {
  return useApiMutation<AdminCreateBookingRequest, AdminCreateBookingResponse>({
    call: (token, body, idempotencyKey) => bookingsApi.create(token, body, idempotencyKey),
    invalidates: [keys.bookings.all()],
    successMessage: 'Booking created. Assign a driver to it.',
  });
}

/** Find, or create, the customer behind a phone number. */
export function useCreateCustomer() {
  return useApiMutation<AdminCreateCustomerRequest, AdminCreateCustomerResponse>({
    call: (token, body) => customersApi.create(token, body),
    invalidates: [keys.customers.all()],
  });
}

/** Hand a manual booking to automatic dispatch. */
export function useEnableAutoDispatch() {
  return useApiMutation<{ id: string }, unknown>({
    call: (token, { id }) => bookingsApi.enableAutoDispatch(token, id),
    invalidates: [keys.bookings.all()],
    successMessage: 'Automatic dispatch is now looking for a driver.',
  });
}

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
