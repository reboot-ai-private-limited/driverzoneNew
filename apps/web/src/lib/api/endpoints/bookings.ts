import type {
  AdminCreateBookingRequest,
  AdminCreateBookingResponse,
  AdminBookingListDto,
  AdminListBookingsQuery,
  BookingDto,
  BookingEventDto,
  BookingStatus,
  Money,
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

/**
 * A driver the panel may hand a booking to. `is_on_duty` is rendered as a warning, not a gate —
 * so is `vehicle_compatible`, which is `null` whenever the caller did not pass a `bookingId` (or
 * it did not resolve). The server is the actual gate on a vehicle mismatch, not this flag.
 */
export interface AssignableDriverDto {
  id: string;
  name: string | null;
  phone: string;
  is_on_duty: boolean;
  vehicle_compatible: boolean | null;
}

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

  /**
   * `POST /admin/bookings` — book a trip for a customer from the panel.
   *
   * MANUAL DISPATCH: nobody is rung, the admin assigns the driver afterwards. The response's
   * `booking.start_otp` is filled in so it can be passed on to the customer. Idempotency-Key is
   * required — one click, one booking, however many retries.
   */
  create: (token: string, body: AdminCreateBookingRequest, idempotencyKey: string) =>
    request<AdminCreateBookingResponse>('/admin/bookings', {
      token,
      method: 'POST',
      body,
      idempotencyKey,
    }),

  /** `POST /admin/bookings/:id/auto-dispatch` — let the system find a driver for a manual booking. */
  enableAutoDispatch: (token: string, id: string) =>
    request<{ booking: BookingDto }>(`/admin/bookings/${id}/auto-dispatch`, {
      token,
      method: 'POST',
    }),

  events: (token: string, id: string, signal?: AbortSignal) =>
    request<BookingEventsDto>(`/admin/bookings/${id}/events`, { token, signal }),

  /**
   * `POST /admin/bookings/:id/cancel` — ops killing a trip.
   *
   * NOBODY IS CHARGED. Not the customer, not the driver: an admin cancellation is the company
   * deciding the trip will not happen, so there is no fee ladder to read and no penalty to write.
   * A prepaid booking is refunded in full. The reason reaches both parties verbatim.
   */
  cancel: (token: string, id: string, reason: string) =>
    request<{ booking: BookingDto; fee: Money; refunded: Money }>(
      `/admin/bookings/${id}/cancel`,
      { token, method: 'POST', body: { reason } },
    ),

  /**
   * `GET /admin/bookings/assignable-drivers` — the manual-assignment picker.
   *
   * `is_on_duty` IS A WARNING, NOT A FILTER. An admin assigning an off-duty driver has almost
   * always just phoned them, which is the case manual assignment exists for — so the server
   * returns them and the UI says so rather than hiding them. `bookingId`, when passed, is what
   * lets the server annotate `vehicle_compatible` the same way.
   */
  assignableDrivers: (token: string, search: string, bookingId?: string, signal?: AbortSignal) =>
    request<AssignableDriverDto[]>('/admin/bookings/assignable-drivers', {
      token,
      signal,
      query: { search, ...(bookingId === undefined ? {} : { booking_id: bookingId }) },
    }),

  /**
   * `POST /admin/bookings/:id/assign` — release whoever has the trip and give it to `driverId`.
   *
   * Served by `dispatch` despite the path saying bookings, because assigning a driver writes
   * `bookings.driverId` and dispatch is the only module permitted to. Refused on a STARTED trip:
   * moving one of those is a cancellation plus a new booking, not a transfer.
   */
  /** `reason` is optional — omitted, the server records "Assigned by admin". */
  assign: (token: string, id: string, driverId: string, reason?: string) =>
    request<{
      booking_id: string;
      reference: string;
      driver_id: string | null;
      released_driver_id: string | null;
    }>(`/admin/bookings/${id}/assign`, {
      token,
      method: 'POST',
      body: { driver_id: driverId, ...(reason === undefined ? {} : { reason }) },
    }),
};
