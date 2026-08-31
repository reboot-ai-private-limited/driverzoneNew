import type { Money } from './http.js';

/**
 * Bookings — the shared vocabulary of the trip lifecycle.
 *
 * The full request/response DTOs land with the bookings module. What is here is the part other
 * tiers need before that exists: the status enum, which `pricing` reads to decide a cancellation
 * fee, and which the admin panel and both mobile apps switch on to decide what screen to show.
 *
 * See docs/LLD/booking-lifecycle.md for the transition table. No code path writes a status
 * outside the bookings module's `transition()` — that is invariant B-3, and it is what makes the
 * event log trustworthy enough to answer a dispute from.
 */

/**
 * `DRAFT` and `QUOTED` are deliberately absent. They describe a customer who has not bought
 * anything yet, and that lives on the `quotes` collection — a booking row comes into existence
 * only once there is money to collect.
 *
 * `PENDING_PAYMENT` is where one now starts: the quote is consumed and the fare frozen, but the
 * driver is not looked for until the payment is captured. A booking abandoned here is swept to
 * `EXPIRED`.
 */
export const BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'SEARCHING',
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'COMPLETED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN',
  'NO_DRIVER_FOUND',
  'EXPIRED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Who caused a transition. Recorded on every `bookingEvents` row alongside the actor's id. */
export const BOOKING_ACTOR_TYPES = ['CUSTOMER', 'DRIVER', 'ADMIN', 'SYSTEM'] as const;
export type BookingActorType = (typeof BOOKING_ACTOR_TYPES)[number];

export const SERVICE_TYPES = ['INCITY', 'OUTSTATION'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

/**
 * `Idempotency-Key` is REQUIRED on this request — one tap, one key, however many network retries
 * it takes. Without it a flaky connection charges a customer twice.
 */
export interface CreateBookingRequest {
  quoteId: string;
  pickupAddress: string;
  dropAddress: string;
}

export interface CreateBookingResponse {
  booking: BookingDto;
  /**
   * Hand this to the payment provider's SDK. Null when the charge already settled, which is what
   * a retry looks like — the app should poll the booking rather than opening a payment sheet.
   */
  client_token: string | null;
}

export interface BookingDto {
  id: string;
  /** `DZ-8F3K2M`. What the customer reads out to support — never the raw id. */
  reference: string;
  status: BookingStatus;
  service_type: ServiceType;

  pickup: { lat: number; lng: number; address: string };
  drop: { lat: number; lng: number; address: string };

  scheduled_at: string;
  is_scheduled: boolean;

  /**
   * The four-digit code the customer reads to the driver at pickup.
   *
   * PRESENT ONLY ON THE CUSTOMER'S OWN READ of their own booking, and null everywhere else — the
   * driver's view of the same booking never carries it, because the whole point is that the
   * driver has to be told it by a person who is standing there.
   */
  start_otp: string | null;

  driver: { id: string; name: string | null } | null;

  fare: {
    lines: Array<{ code: string; label: string; amount: Money }>;
    subtotal: Money;
    tax: Money;
    total: Money;
  };

  /** Charges decided after the quote — waiting time so far. Never edits `fare`. */
  adjustments: Array<{ type: string; label: string; amount: Money }>;

  timestamps: {
    assigned_at: string | null;
    en_route_at: string | null;
    arrived_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
  };

  cancellation_reason: string | null;
}

/** One row of the booking's history. Rendered verbatim in the admin panel's detail view. */
export interface BookingEventDto {
  from_status: BookingStatus | null;
  to_status: BookingStatus;
  actor_type: BookingActorType;
  reason: string | null;
  metadata: Record<string, unknown>;
  at: string;
}

export interface CancelBookingRequest {
  reason: string;
}

export interface CancelBookingResponse {
  booking: BookingDto;
  /** What was kept, per the ladder the customer saw before confirming. */
  fee: Money;
  refunded: Money;
}

/** A location fix the server measures against the pickup point. Older than a minute is refused. */
export interface DriverLocationFix {
  lat: number;
  lng: number;
  /** ISO 8601, when the fix was taken on the device — not when the request was sent. */
  takenAt: string;
}

export interface DriverArrivedRequest {
  location: DriverLocationFix;
}

export interface StartTripRequest {
  otp: string;
  location?: { lat: number; lng: number } | undefined;
}

export interface CompleteTripRequest {
  actualDistanceM?: number | undefined;
}

export interface CompleteTripResponse {
  booking: BookingDto;
  waiting_charge: Money;
  total: Money;
}

export interface ReportPickupPinRequest {
  location: { lat: number; lng: number };
  note?: string | undefined;
}
