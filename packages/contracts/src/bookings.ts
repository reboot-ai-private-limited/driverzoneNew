import type { CarCategory, VehicleTypePreference } from './identity.js';
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
  /**
   * The car the driver will be driving — the CUSTOMER's own car, since that is the whole service
   * (docs/LLD/open-questions.md Q5). Chosen at booking rather than at quote time because neither
   * field prices anything: an SUV and a hatchback pay the same fare for the same trip (retired as
   * a pricing dimension on 2026-08-28, docs/decision-log.md). What they decide is WHO RINGS.
   */
  carCategory: CarCategory;
  vehicleType: VehicleTypePreference;
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
   * What the customer said they would be putting the driver in, and what dispatch matched on.
   *
   * NULL ON BOOKINGS MADE BEFORE 2026-09-02, when the choice did not exist. A null is not "any" —
   * it is "never asked", and dispatch treats it that way: an old booking skips the competency
   * filter rather than matching every driver or none.
   */
  car_category: CarCategory | null;
  vehicle_type: VehicleTypePreference | null;

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

  /**
   * Who is driving, as much of them as the customer is entitled to see.
   *
   * WAS `{ id, name }` UNTIL 2026-09-04, and the trip screen carried a note saying a richer card
   * was "a real thing to build once the identity module has something behind it to show". It has:
   * drivers upload an avatar to a PUBLIC bucket precisely so a customer can see who is coming, and
   * `reviews` keeps a rolling average on the account.
   *
   * `phone` IS THE ONE FIELD THAT COMES AND GOES. It is present only while the trip is live —
   * assigned, en route, arrived, started — and null the moment it ends. A customer needs to reach
   * the driver at the kerb; a customer from three months ago does not, and that number is also the
   * one the driver's own login OTP is sent to. The server decides this, not the screen: a field
   * withheld cannot be read out of a cached response.
   *
   * `rating` is null until somebody has actually rated them. The account row defaults to 5.0, so
   * rendering it unconditionally would show every new driver a five-star average they have not
   * earned — `rating_count` is what tells the two apart.
   */
  driver: {
    id: string;
    name: string | null;
    /** A fetchable URL, not a storage key. Null when the driver has not uploaded one. */
    photo_url: string | null;
    rating: number | null;
    rating_count: number;
    /** Live trips only — see above. */
    phone: string | null;
  } | null;

  /**
   * Who the trip is for.
   *
   * `phone` IS THE MIRROR of `driver.phone` above — present only while the trip is live (assigned,
   * en route, arrived, started) and null the moment it ends. A driver needs to reach the customer
   * at the kerb; a driver looking at a trip from three months ago does not, and that number is
   * also the one the customer's own login OTP is sent to. The server decides this, not the
   * screen: a field withheld cannot be read out of a cached response. It is null on every
   * customer-facing and admin read, and on any driver read where the trip is not live.
   *
   * `name` is null when the account never set one, and the whole object is null on a booking read
   * by a caller the mapper was not asked to resolve the customer for — never a placeholder, so a
   * screen can tell "no name on file" from "not looked up".
   */
  customer: { id: string; name: string | null; phone: string | null } | null;

  fare: {
    lines: Array<{ code: string; label: string; amount: Money }>;
    subtotal: Money;
    tax: Money;
    total: Money;
  };

  /** Charges decided after the quote — waiting time so far. Never edits `fare`. */
  adjustments: Array<{ type: string; label: string; amount: Money }>;

  /**
   * What the customer's wallet did to this trip, frozen when it was booked.
   *
   * `wallet_credit` came OFF the fare and `wallet_debt` (an older unpaid cancellation fee) was
   * added to it — so what was actually payable is `fare.total − wallet_credit + wallet_debt`,
   * before any adjustment. Never both non-zero: a balance is either credit or debt.
   *
   * Zero on bookings made before wallets existed, which is the truthful answer for them.
   */
  wallet_credit: Money;
  wallet_debt: Money;

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

/**
 * `GET /customer/bookings` — the signed-in customer's own ride history, newest first.
 *
 * THE SAME `BookingDto` AS THE SINGLE READ, not a trimmed list row. A history list and a booking
 * detail are the same object seen at two distances, and giving the list its own narrower shape
 * would mean every field the detail screen later wants is a second endpoint change. The one
 * difference is enforced in the mapper rather than the type: `start_otp` is null on every row
 * here, because a list of trip codes is not something a history screen has any business holding.
 */
export interface ListBookingsResponse {
  bookings: BookingDto[];
}

/**
 * `GET /driver/bookings` — every trip this driver has been assigned, newest first.
 *
 * THE SAME SHAPE AS THE CUSTOMER'S HISTORY, for the same reason it reuses `BookingDto`: a trips
 * list and a trip receipt are one object at two distances. What differs is what the mapper fills
 * in — these rows carry `customer` (resolved in one batched lookup) and never `start_otp`, which
 * is the exact mirror of the customer's list carrying `driver` and no code.
 *
 * ASSIGNED TRIPS ONLY. A booking this driver was rung for and lost was never theirs, so it is not
 * in their history — the offer they declined is not a trip that happened to them.
 */
export interface ListDriverTripsResponse {
  bookings: BookingDto[];
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

/**
 * `GET /driver/bookings/current` — the trip the signed-in driver is in the middle of.
 *
 * `null` is a normal answer, not an error: the app asks this on every launch precisely because it
 * usually has nothing to resume. It exists because a driver's app is killed mid-trip by the OEM
 * battery managers `battery-setup` warns about, taking the booking id in its navigation state with
 * it — leaving no way to arrive, start or complete a trip a customer is waiting on.
 */
export interface CurrentDriverTripResponse {
  booking: BookingDto | null;
}

/**
 * `GET /customer/bookings/current` — the booking happening to this customer right now.
 *
 * CARRIES `start_otp`, unlike the history list. That is the reason it exists rather than a
 * detail of it: the trip code is shown on the live trip screen only, so a customer whose app was
 * killed at the pickup had no way back to the four digits their driver was waiting for — the
 * history screen is a receipt and holds neither the code nor the cancel action.
 *
 * A scheduled booking sitting at `CONFIRMED` is NOT "current": it would otherwise pull a customer
 * into a trip booked for next week every time they opened the app.
 */
export interface CurrentCustomerBookingResponse {
  booking: BookingDto | null;
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
