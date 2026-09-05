import type {
  BookingDto,
  CancelBookingResponse,
  CompleteTripResponse,
  CurrentDriverTripResponse,
  ListDriverTripsResponse,
  RateTripRequest,
  RateTripResponse,
} from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { getAccessToken } from '../../auth/session';
import { request } from '../client';

/**
 * `/driver/bookings/*` — the trip a driver is actually doing
 * (apps/api/src/modules/bookings/interface/bookings.routes.ts).
 *
 * The lifecycle is a STATE MACHINE ON THE SERVER, not a sequence this file decides:
 *
 *   ASSIGNED ──en-route──▶ DRIVER_EN_ROUTE ──arrived──▶ ARRIVED ──start──▶ STARTED ──complete──▶ COMPLETED
 *
 * Every call below returns the booking as it stands AFTER the transition, so the screen re-renders
 * from the server's answer rather than assuming its own optimistic next state. A transition that
 * has already happened elsewhere (support forced it, the customer cancelled) comes back as the
 * real status, and the screen follows it.
 */

export function getTrip(bookingId: string, signal?: AbortSignal): Promise<BookingDto> {
  return request<BookingDto>(`${ROLE_PREFIX}/bookings/${bookingId}`, {
    token: getAccessToken() ?? undefined,
    signal,
  });
}

/**
 * `GET /driver/bookings` — every trip this driver has been assigned, newest first.
 *
 * SERVER-CAPPED, NOT PAGED (`HISTORY_LIMIT` on the API side), which is what lets the Trips screen
 * filter and search over the whole list client-side. Paging under a client-side filter would
 * silently hide matches on page two — the same trade the customer app's ride history makes, and
 * the same note applies: filters move server-side in the change that adds a cursor, not before.
 */
export function listTrips(signal?: AbortSignal): Promise<ListDriverTripsResponse> {
  return request<ListDriverTripsResponse>(`${ROLE_PREFIX}/bookings`, {
    token: getAccessToken() ?? undefined,
    signal,
  });
}

/** "I am setting off." ASSIGNED → DRIVER_EN_ROUTE. No body; the server times it. */
export function goEnRoute(bookingId: string): Promise<BookingDto> {
  return request<BookingDto>(`${ROLE_PREFIX}/bookings/${bookingId}/en-route`, {
    method: 'POST',
    token: getAccessToken() ?? undefined,
  });
}

/**
 * "I am at the pickup." DRIVER_EN_ROUTE → ARRIVED.
 *
 * THE ONE GATE THAT BLOCKS. The server refuses this beyond `dispatch.arrival_radius_m` with
 * `DRIVER_NOT_AT_PICKUP`, and refuses a stale fix with `DRIVER_LOCATION_STALE` — because reaching
 * ARRIVED starts the customer's waiting-charge clock, so marking it from the highway bills them
 * for time nobody spent waiting. The location is required for that reason and cannot be faked
 * away client-side.
 */
export function markArrived(
  bookingId: string,
  location: { lat: number; lng: number; takenAt: string },
): Promise<BookingDto> {
  return request<BookingDto>(`${ROLE_PREFIX}/bookings/${bookingId}/arrived`, {
    method: 'POST',
    body: { location },
    token: getAccessToken() ?? undefined,
  });
}

/**
 * "The customer gave me the code." ARRIVED → STARTED.
 *
 * FOUR digits, not the six the login OTP uses — `startTripSchema` is `/^\d{4}$/`.
 *
 * The location here WARNS rather than blocks (the opposite of `markArrived`): by this point the
 * customer is in the car, and refusing would strand a trip that is genuinely happening. It is
 * sent when we have it and omitted when we do not.
 */
export function startTrip(
  bookingId: string,
  otp: string,
  location?: { lat: number; lng: number },
): Promise<BookingDto> {
  return request<BookingDto>(`${ROLE_PREFIX}/bookings/${bookingId}/start`, {
    method: 'POST',
    body: location === undefined ? { otp } : { otp, location },
    token: getAccessToken() ?? undefined,
  });
}

/**
 * "We are there." STARTED → COMPLETED, and the call that writes the driver's earnings.
 *
 * IDEMPOTENCY-KEYED ON THE BOOKING, not on a random value. The server requires the header, and
 * `complete-<bookingId>` is the honest key: completing one booking twice is precisely the request
 * that must collapse into one, so a retry after a timeout settles the trip once and pays once
 * rather than appending a second set of ledger rows.
 *
 * `cashCollectedPaise` is deliberately not sent. The server falls back to the expected total when
 * it is absent, which is what a driver who collected the fare as quoted actually did — inventing
 * a figure here would be the app asserting something it never asked anybody.
 */
export function completeTrip(bookingId: string): Promise<CompleteTripResponse> {
  return request<CompleteTripResponse>(`${ROLE_PREFIX}/bookings/${bookingId}/complete`, {
    method: 'POST',
    body: {},
    idempotencyKey: `complete-${bookingId}`,
    token: getAccessToken() ?? undefined,
  });
}

/**
 * "I am here and the pin is not."
 *
 * The documented way out of the arrival gate, and deliberately NOT a self-serve override: it
 * files the mismatch for support rather than letting the driver mark themselves arrived. Without
 * it, `DRIVER_NOT_AT_PICKUP` is a dead end on a screen the driver cannot leave.
 */
export function reportPickupPin(
  bookingId: string,
  location: { lat: number; lng: number },
  note?: string,
): Promise<{ distance_metres: number }> {
  return request<{ distance_metres: number }>(`${ROLE_PREFIX}/bookings/${bookingId}/pin-report`, {
    method: 'POST',
    body: note === undefined ? { location } : { location, note },
    token: getAccessToken() ?? undefined,
  });
}

/**
 * `GET /driver/bookings/current` — the trip this driver is in the middle of, or `null`.
 *
 * THE RECOVERY READ, and the counterpart to `listOffers`. A driver's app is killed mid-trip
 * by the OEM battery managers `battery-setup` exists to fight, and the booking id needed to get
 * back only ever lived in navigation state, which dies with the process. Asked on every launch;
 * `null` most of the time, and that is a normal answer rather than an error.
 */
export function getCurrentTrip(signal?: AbortSignal): Promise<CurrentDriverTripResponse> {
  return request<CurrentDriverTripResponse>(`${ROLE_PREFIX}/bookings/current`, {
    token: getAccessToken() ?? undefined,
    signal,
  });
}

/**
 * `POST /driver/bookings/:id/cancel` — the driver drops a trip they had accepted.
 *
 * ALLOWED FROM ASSIGNED, DRIVER_EN_ROUTE AND ARRIVED, and from nowhere else: once the trip has
 * STARTED the customer is in the car, and the state machine (`TRANSITIONS`) offers a driver no
 * cancellation from there — only an admin can end a running trip. The screen must not offer it
 * either, or the button is one that can only produce an error.
 *
 * THERE IS NO FREE WINDOW on this side, unlike the customer's ladder. A driver who accepted has
 * already taken the booking out of dispatch whatever the clock says, so the penalty depends only
 * on how far along they were — nothing at ASSIGNED, `cancellation.driver_penalty_en_route` once
 * they set off, `cancellation.driver_penalty_arrived` once they arrived. It lands as a `PENALTY`
 * row on their ledger, which is why the sheet states the figure before they commit.
 *
 * `reason` is REQUIRED by the server (`requireReason`) — an empty one is a 400, not a default.
 */
export function cancelTrip(bookingId: string, reason: string): Promise<CancelBookingResponse> {
  return request<CancelBookingResponse>(`${ROLE_PREFIX}/bookings/${bookingId}/cancel`, {
    method: 'POST',
    body: { reason },
    token: getAccessToken() ?? undefined,
  });
}

/**
 * `POST /driver/bookings/:id/rate` — the driver's review OF THE CUSTOMER.
 *
 * Mounted by the REVIEWS module, not bookings, on the same prefix by the fall-through `routes.ts`
 * documents. Kept in this file anyway: from the app's side it is one more thing done to a booking
 * id, and nothing here has reason to know where the server drew its module boundary.
 *
 * Nothing in the body names the customer. The reviewer comes from the bearer, the reviewee from
 * the booking, and the role from the router — so this cannot be aimed at somebody the driver
 * never drove.
 *
 * DOUBLE-BLIND. Neither side's review is published until both have rated or
 * `reviews.submission_window_hours` elapses, so a driver rating honestly cannot be retaliated
 * against — and a driver who never rates leaves the customer's review of them sitting unpublished
 * until the window closes.
 */
export function rateCustomer(
  bookingId: string,
  body: RateTripRequest,
): Promise<RateTripResponse> {
  return request<RateTripResponse>(`${ROLE_PREFIX}/bookings/${bookingId}/rate`, {
    method: 'POST',
    body,
    token: getAccessToken() ?? undefined,
  });
}
