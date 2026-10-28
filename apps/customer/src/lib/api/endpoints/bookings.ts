import type {
  BookingDto,
  BookingExtensionDto,
  CancelBookingRequest,
  CancelBookingResponse,
  CreateBookingRequest,
  CreateBookingResponse,
  CreateGstInvoiceRequest,
  CurrentCustomerBookingResponse,
  CustomerGstInvoiceResponse,
  GstInvoiceRequestDto,
  ListBookingsQuery,
  ListBookingsResponse,
  PaymentMode,
  PayTripExtrasResponse,
  RateTripRequest,
  RateTripResponse,
  SelectPaymentMethodResponse,
  VerifyPaymentResponse,
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
 * `GET /customer/bookings` — one PAGE of this customer's own ride history, filtered, searched and
 * sorted by the server. Pass the previous page's `next_cursor` as `cursor` for the next one; the
 * first page (no cursor) also carries the whole-history `summary`.
 *
 * Scoped by the access token alone; there is no id to pass and therefore no way to ask for
 * anybody else's. Rows carry `start_otp: null` by design — the code only ever comes back from the
 * single-booking read below.
 */
export function listBookings(query: ListBookingsQuery): Promise<ListBookingsResponse> {
  return request<ListBookingsResponse>(`${ROLE_PREFIX}/bookings`, {
    token: getAccessToken() ?? undefined,
    query: { ...query },
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
 * `GET /customer/bookings/current` — THE RECOVERY READ.
 *
 * Android kills a backgrounded app whenever it wants memory, and the booking id lived only in
 * this app's navigation state. Reopening therefore landed on the booking map with a driver
 * already on the way and no route back — and the history screen is deliberately a receipt, so
 * finding the ride there reached neither the live status nor `start_otp`, the four digits the
 * customer has to read out before their trip can begin.
 *
 * Carries the OTP for that reason. `null` most of the time, which is a normal answer to a
 * question asked on every launch, not an error.
 */
export function getCurrentBooking(signal?: AbortSignal): Promise<CurrentCustomerBookingResponse> {
  return request<CurrentCustomerBookingResponse>(`${ROLE_PREFIX}/bookings/current`, {
    token: getAccessToken() ?? undefined,
    signal,
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
 * The request and response types now live in `@driverzone/contracts`, where the note that used to
 * sit here said they should go "once a second client needs the same shape". The driver app is
 * that second client: it rates the customer through the same endpoint mounted on `/driver`, and
 * two hand-written copies of one wire format is how they drift.
 */
/**
 * `POST /customer/bookings/:id/extend` — asks the driver to stay one more day.
 *
 * IT ASKS; IT DOES NOT BUY. Nothing is charged here and nothing is promised: the driver has to
 * accept, and an extra day commits their next 24 hours. A declined or unanswered request costs
 * the customer nothing at all.
 *
 * SETTLES AT THE END, not now. An accepted day is added to the bill at completion alongside any
 * waiting charge — one settlement on UPI, or cash at the door.
 *
 * Only on an OUTSTATION trip that has STARTED. `BookingDto.extension.can_extend` is the server's
 * own answer to that, and the screen renders the button from it rather than re-deriving it.
 */
export function requestDayExtension(bookingId: string): Promise<BookingExtensionDto> {
  return request<BookingExtensionDto>(`${ROLE_PREFIX}/bookings/${bookingId}/extend`, {
    method: 'POST',
    token: getAccessToken() ?? undefined,
  });
}

export function rateTrip(bookingId: string, body: RateTripRequest): Promise<RateTripResponse> {
  return request<RateTripResponse>(`${ROLE_PREFIX}/bookings/${bookingId}/rate`, {
    method: 'POST',
    body,
    token: getAccessToken() ?? undefined,
  });
}

/**
 * `GET /customer/bookings/:id/gst-invoice` — mounted by the INVOICES module, on the same prefix
 * fall-through as `/rate`. This trip's request, or the details to pre-fill a new one with.
 */
export function getGstInvoice(bookingId: string, signal?: AbortSignal): Promise<CustomerGstInvoiceResponse> {
  return request<CustomerGstInvoiceResponse>(`${ROLE_PREFIX}/bookings/${bookingId}/gst-invoice`, {
    signal,
    token: getAccessToken() ?? undefined,
  });
}

/** `POST /customer/bookings/:id/gst-invoice` — one request per completed trip. */
export function requestGstInvoice(
  bookingId: string,
  body: CreateGstInvoiceRequest,
): Promise<GstInvoiceRequestDto> {
  return request<GstInvoiceRequestDto>(`${ROLE_PREFIX}/bookings/${bookingId}/gst-invoice`, {
    method: 'POST',
    body,
    token: getAccessToken() ?? undefined,
  });
}

/**
 * `POST /customer/bookings/:id/payment-method` — selects CASH or UPI once the trip has STARTED.
 */
export function selectPaymentMethod(
  bookingId: string,
  paymentMode: PaymentMode,
  idempotencyKey: string,
): Promise<SelectPaymentMethodResponse> {
  return request<SelectPaymentMethodResponse>(
    `${ROLE_PREFIX}/bookings/${bookingId}/payment-method`,
    {
      method: 'POST',
      body: { payment_mode: paymentMode },
      idempotencyKey,
      token: getAccessToken() ?? undefined,
    },
  );
}

/**
 * `POST /customer/bookings/:id/payment/verify` — hands the checkout SDK's signed result back for
 * server-side verification, so the trip confirms without waiting out the webhook.
 *
 * The order id is deliberately not sent: the server reads it from the booking's own payment row.
 */
export function verifyPayment(
  bookingId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
): Promise<VerifyPaymentResponse> {
  return request<VerifyPaymentResponse>(`${ROLE_PREFIX}/bookings/${bookingId}/payment/verify`, {
    method: 'POST',
    body: { razorpay_payment_id: razorpayPaymentId, razorpay_signature: razorpaySignature },
    token: getAccessToken() ?? undefined,
  });
}

/**
 * `POST /customer/bookings/:id/extras/pay` — a checkout for the extra day the driver agreed to.
 *
 * A SECOND ORDER, DELIBERATELY. The trip's own order was raised — and usually already paid —
 * before the extra day existed, and a gateway order cannot be repriced once its id is in the
 * customer's hands. `payable.outstanding` on the booking is what says this is needed and for how
 * much; this opens the order to cover it.
 *
 * NO IDEMPOTENCY KEY FROM HERE. The server keys it on the number of days already agreed, which is
 * the only thing that genuinely changes the amount — a per-tap key would open a second order for
 * the same day, and a per-booking one would hand back the first day's order after a second
 * extension.
 */
export function payTripExtras(bookingId: string): Promise<PayTripExtrasResponse> {
  return request<PayTripExtrasResponse>(`${ROLE_PREFIX}/bookings/${bookingId}/extras/pay`, {
    method: 'POST',
    token: getAccessToken() ?? undefined,
  });
}

/**
 * The same accelerant `verifyPayment` is, for that order.
 *
 * IT NAMES THE PAYMENT, which the fare's verify does not have to: the booking carries exactly one
 * fare payment and the server can find it, whereas a trip extended twice has more than one extras
 * order. The ORDER id is still never sent — the server reads that from the row.
 */
export function verifyExtrasPayment(
  bookingId: string,
  paymentId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
): Promise<VerifyPaymentResponse> {
  return request<VerifyPaymentResponse>(`${ROLE_PREFIX}/bookings/${bookingId}/extras/verify`, {
    method: 'POST',
    body: {
      payment_id: paymentId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    },
    token: getAccessToken() ?? undefined,
  });
}
