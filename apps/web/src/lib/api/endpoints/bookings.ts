import type {
  AdminBookingListDto,
  AdminListBookingsQuery,
  BookingDto,
  BookingEventDto,
  BookingStatus,
} from '@driverzone/contracts';
import { request } from '../client';

/**
 * `/admin/bookings` — mirrors `apps/api/src/modules/bookings/interface/bookings.routes.ts`.
 *
 * The wire types live in `@driverzone/contracts`, which is where they belong now that the server
 * actually produces them. They were declared locally in this file while the endpoints did not
 * exist — a contract package is the shared truth about what a server produces, not a wish list of
 * what it might one day, which is the same note `endpoints/customers.ts` carries about its own
 * spell in that state.
 *
 * `search` matches a booking reference OR either party's name or mobile number; the server
 * resolves the second half through `identity` and unions the two. Filtering, paging and the date
 * range are all SERVER-SIDE, because the list pages — a filter applied here would only search the
 * rows already fetched and would miss every match on page two.
 */

/** Builds the `status` param from selected statuses. `undefined` when nothing is selected. */
export function statusParam(statuses: readonly BookingStatus[]): string | undefined {
  return statuses.length === 0 ? undefined : statuses.join(',');
}

/**
 * `GET /admin/bookings/:id/events` — the controller answers with the reference alongside the rows
 * so a view opened from a link can title itself without the booking.
 */
export interface BookingEventsDto {
  reference: string;
  events: BookingEventDto[];
}

/**
 * READS TAKE A TRAILING `signal`; WRITES DO NOT — the rule `endpoints/customers.ts` and
 * `endpoints/zones.ts` both state. A read is abandoned the moment its query key changes; a write
 * that has reached the server cannot be un-sent.
 */
export const bookingsApi = {
  list: (token: string, query?: AdminListBookingsQuery, signal?: AbortSignal) =>
    request<AdminBookingListDto>('/admin/bookings', {
      token,
      signal,
      ...(query === undefined
        ? {}
        : {
            query: {
              search: query.search,
              status: query.status,
              from: query.from,
              to: query.to,
              page: query.page,
              limit: query.limit,
            },
          }),
    }),

  get: (token: string, id: string, signal?: AbortSignal) =>
    request<BookingDto>(`/admin/bookings/${id}`, { token, signal }),

  events: (token: string, id: string, signal?: AbortSignal) =>
    request<BookingEventsDto>(`/admin/bookings/${id}/events`, { token, signal }),
};
