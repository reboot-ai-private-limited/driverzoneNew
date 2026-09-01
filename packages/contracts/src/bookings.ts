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
 * How the customer pays.
 *
 * `UPI` is prepaid: the booking waits at `PENDING_PAYMENT` until Razorpay confirms, so a driver is
 * never sent to someone who has not paid. `CASH` collects nothing up front and confirms
 * immediately — the driver takes the fare at the end, which is why a cash trip is the only one
 * that puts a driver into debt to the company.
 *
 * There is no card or netbanking mode. Checkout is restricted to UPI, and the Collect flow is
 * deprecated by NPCI as of 28 February 2026, so it is UPI Intent specifically.
 */
export const PAYMENT_MODES = ['UPI', 'CASH'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/**
 * `Idempotency-Key` is REQUIRED on this request — one tap, one key, however many network retries
 * it takes. Without it a flaky connection charges a customer twice.
 */
export interface CreateBookingRequest {
  quoteId: string;
  pickupAddress: string;
  dropAddress: string;
  paymentMode: PaymentMode;
}

export interface CreateBookingResponse {
  booking: BookingDto;
  /**
   * The Razorpay ORDER id, to hand to checkout. Null for a cash booking, which has no payment, and
   * null on a retry whose charge already settled — in both cases the app shows the trip rather
   * than a payment sheet.
   */
  client_token: string | null;
  /** The publishable `rzp_test_…`/`rzp_live_…` key checkout needs beside the order. Null for cash. */
  public_key: string | null;
  /** What the order is for: the fare, plus any unpaid dues carried from an earlier booking. */
  amount: Money | null;
}

export interface BookingDto {
  id: string;
  /** `DZ-8F3K2M`. What the customer reads out to support — never the raw id. */
  reference: string;
  status: BookingStatus;
  service_type: ServiceType;
  payment_mode: PaymentMode;

  pickup: { lat: number; lng: number; address: string };
  drop: { lat: number; lng: number; address: string };

  scheduled_at: string;
  is_scheduled: boolean;

  /**
   * Incity only, frozen at booking time. Outstation is null — a package there is a package
   * however long it takes, there is no minutes figure to freeze (see the same field on
   * `QuoteOptionDto`). Lets the trip screen say when an incity rental is due back without
   * inventing an ETA the fare itself does not have an opinion about.
   */
  included_minutes: number | null;

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

/**
 * What the customer owes, and therefore how they may pay.
 *
 * A fact about the CUSTOMER, not about a trip, which is why it is its own endpoint rather than a
 * field on a quote — a quote is priced for two points on a map and knows nothing about debts. It
 * also keeps `quotes` from having to reach into `bookings`, which sits a tier above it.
 */
export interface CustomerDuesResponse {
  outstanding: Money;
  /** `CASH` disappears while dues are unpaid: a cash trip has no payment leg to clear them on. */
  payment_modes: PaymentMode[];
}

export interface ReportPickupPinRequest {
  location: { lat: number; lng: number };
  note?: string | undefined;
}
