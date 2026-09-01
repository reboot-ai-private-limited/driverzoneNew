import type {
  BookingDto,
  CancelBookingRequest,
  CancelBookingResponse,
  CreateBookingRequest,
  CreateBookingResponse,
} from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { request } from '../client';
import { getAccessToken } from '../../auth/session';

/**
 * `/customer/bookings` — apps/api/src/modules/bookings/interface/bookings.routes.ts.
 *
 * `POST /` does NOT confirm the booking, even for a mode that settles instantly — it hands back
 * whatever `CreateBookingResponse` says and the booking's own `status` is the only truth. For
 * `paymentMode: 'CASH'` that status already reads `CONFIRMED` in the same response (the API
 * transitions it synchronously, no gateway involved); for `'UPI'` it is still `PENDING_PAYMENT`
 * and nothing in this file waits for the webhook that would move it — that is `GET /:id`'s job,
 * polled from the trip screen.
 */

/**
 * REQUIRES an idempotency key — this endpoint has no default the way `createQuote` does, because
 * a booking with a missing key is not "retry as normal", it is "charge or double-book on a flaky
 * connection". The caller owns generating one and holding it stable across retries of ONE
 * attempt; `FareSheet` keeps it in a ref for exactly that reason.
 */
export function createBooking(
  body: CreateBookingRequest,
  idempotencyKey: string,
): Promise<CreateBookingResponse> {
  return request<CreateBookingResponse>(`${ROLE_PREFIX}/bookings`, {
    method: 'POST',
    body,
    idempotencyKey,
    token: getAccessToken() ?? undefined,
  });
}

/**
 * The customer's own view of one booking — the only one carrying `start_otp`. Polled, never
 * cached indefinitely: a trip's status is exactly the kind of thing that goes stale in seconds,
 * not the kind `useTripQuote`'s `staleTime: Infinity` is for.
 */
export function getBooking(id: string): Promise<BookingDto> {
  return request<BookingDto>(`${ROLE_PREFIX}/bookings/${id}`, {
    token: getAccessToken() ?? undefined,
  });
}

/**
 * A REASON IS MANDATORY — the API rejects a bare `{}`. `fee`/`refunded` on the response are the
 * only honest source for what a cancellation actually cost; nothing computes the fee ladder on
 * this side, both because the ladder is a settings-driven policy this app does not carry a copy
 * of, and because a client-side guess could disagree with what the customer is actually charged.
 */
export function cancelBooking(id: string, reason: string): Promise<CancelBookingResponse> {
  return request<CancelBookingResponse>(`${ROLE_PREFIX}/bookings/${id}/cancel`, {
    method: 'POST',
    body: { reason } satisfies CancelBookingRequest,
    token: getAccessToken() ?? undefined,
  });
}

/**
 * `POST /customer/bookings/:id/rate` — mounted by the REVIEWS module
 * (`apps/api/src/modules/reviews`), not bookings, but on the same URL prefix (the fall-through
 * pattern `routes.ts` documents for `/customer/bookings/:id/rate`). Kept here anyway: from this
 * app's side it is one more thing you do to a booking id, and a customer reading this file has no
 * reason to know the server drew its own module boundary somewhere the URL does not show.
 *
 * NO SHARED CONTRACT TYPE EXISTS for this endpoint yet — `RateTripInput`/`RateTripResponse` are
 * only ever a zod schema inside `rateTrip.usecase.ts`, never re-exported through
 * `@driverzone/contracts`. The two interfaces below are this file's own reading of that schema
 * and of `RateTripUseCase.execute`'s return type, not something either side is contractually held
 * to — a real interface migrating this to `@driverzone/contracts` is worth doing once a second
 * client (the driver app) needs the same shape.
 */
export interface RateTripRequest {
  rating: number;
  tags?: string[] | undefined;
  comment?: string | undefined;
}

export interface RateTripResponse {
  id: string;
  rating: number;
}

export function rateTrip(bookingId: string, body: RateTripRequest): Promise<RateTripResponse> {
  return request<RateTripResponse>(`${ROLE_PREFIX}/bookings/${bookingId}/rate`, {
    method: 'POST',
    body,
    token: getAccessToken() ?? undefined,
  });
}
