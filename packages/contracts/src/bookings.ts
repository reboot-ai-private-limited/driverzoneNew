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
 * only once the quote is consumed.
 *
 * `PENDING_PAYMENT` is where one starts, but no booking waits there any more: it moves to
 * `CONFIRMED` synchronously, in the same request, and a driver is dispatched immediately —
 * payment method (cash or online) is chosen later, once the ride has STARTED, and paying online
 * at that point never re-visits this status. Kept as the entry point anyway so the very first
 * `bookingEvents` row stays consistent with every booking that came before this changed. The old
 * "swept to `EXPIRED`" sweeper still exists as a defensive no-op for anything that somehow gets
 * stuck here, but nothing produces that state in the ordinary flow any more.
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
 * How the customer pays. Chosen after the ride has STARTED, not at booking time — every booking
 * dispatches immediately regardless of this field, which is `null` until then
 * (`selectPaymentMethod.usecase.ts`).
 *
 * `UPI` charges through Razorpay right when it is selected; the driver cannot complete the trip
 * until that charge captures (`completeTrip.usecase.ts`). `CASH` needs no charge at all — the
 * driver takes the fare at the end, which is why a cash trip is the only one that puts a driver
 * into debt to the company.
 *
 * There is no card or netbanking mode. Checkout is restricted to UPI, and the Collect flow is
 * deprecated by NPCI as of 28 February 2026, so it is UPI Intent specifically.
 */
export const PAYMENT_MODES = ['UPI', 'CASH'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const BOOKING_PAYMENT_STATUSES = [
  'NOT_SELECTED',
  'CASH',
  'AWAITING_PAYMENT',
  'PAID',
] as const;
export type BookingPaymentStatus = (typeof BOOKING_PAYMENT_STATUSES)[number];

/**
 * `Idempotency-Key` is REQUIRED on this request — one tap, one key, however many network retries
 * it takes. Without it a flaky connection charges a customer twice.
 */
export interface CreateBookingRequest {
  quoteId: string;
  pickupAddress: string;
  dropAddress: string;
  paymentMode?: PaymentMode | undefined;
  /**
   * The car the driver will be driving — the CUSTOMER's own car, since that is the whole service
   * (docs/LLD/open-questions.md Q5). Chosen at booking rather than at quote time because neither
   * field prices anything: an SUV and a hatchback pay the same fare for the same trip (retired as
   * a pricing dimension on 2026-08-28, docs/decision-log.md). What they decide is WHO RINGS.
   */
  carCategory: CarCategory;
  vehicleType: VehicleTypePreference;
  /**
   * Ring this customer's favourite drivers before anyone else.
   *
   * OPTIONAL AND FALSE BY DEFAULT, so a client that has never heard of favourites books exactly
   * as it always did. When true, dispatch runs a wave 0 over the customer's favourites — wider
   * than the first normal radius and with its own ring time — then falls through to the ordinary
   * ladder the moment those drivers decline, ignore, or turn out not to be eligible. It is a
   * PREFERENCE, never a restriction: no booking is left without a driver because a favourite was
   * busy.
   */
  preferFavouriteDrivers?: boolean;
}

/** Request to choose how to pay once the trip has STARTED. */
export interface SelectPaymentMethodRequest {
  payment_mode: PaymentMode;
}

export type SelectPaymentMethodResponse = CreateBookingResponse;

/**
 * The checkout SDK's success callback, posted back for server-side verification so the trip can
 * confirm without waiting on the webhook.
 *
 * NO ORDER ID. The signature covers `order_id|payment_id`, and the server reads the order id from
 * the booking's own payment row — a caller who supplied both halves could sign them too.
 */
export interface VerifyPaymentRequest {
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface VerifyPaymentResponse {
  booking: BookingDto;
}

/**
 * `POST /customer/bookings/:id/extras/pay` — an order for what an accepted day extension added.
 *
 * A SECOND ORDER, not an edit to the first. The booking's own order was created (and very often
 * already paid) before the extension existed, and a gateway order's amount cannot be changed after
 * the customer has been handed its id. So the extra gets its own checkout, and
 * `booking.paidExtensionPaise` is what reconciles the two.
 *
 * Shaped like `CreateBookingResponse` minus the booking, plus the payment id — `extras/verify`
 * needs to name WHICH payment it is confirming, since unlike the booking charge this one is not
 * the one hanging off `booking.payment_id`.
 */
export interface PayTripExtrasResponse {
  payment_id: string;
  /** The Razorpay ORDER id, to hand to checkout. */
  client_token: string | null;
  public_key: string | null;
  amount: Money;
}

/** The checkout callback for an extras order. `payment_id` is the one `extras/pay` returned. */
export interface VerifyExtrasPaymentRequest extends VerifyPaymentRequest {
  payment_id: string;
}

/** The driver's fallback when the customer cannot pay online and hands over cash instead. */
export interface SwitchToCashResponse {
  booking: BookingDto;
}

/** One day-extension request, as `POST .../extend` and the driver's accept/decline answer with. */
export interface BookingExtensionDto {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  /** What the customer pays for this one day, settled at completion. */
  amount: Money;
  /** What the DRIVER earns from it — rendered by the driver app when they are asked to confirm. */
  driver_amount: Money;
  /** When it lapses if the driver has not answered. A lapsed request charges nobody. */
  expires_at: string;
  requested_at: string;
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
  payment_mode: PaymentMode | null;
  payment_status: BookingPaymentStatus;

  pickup: { lat: number; lng: number; address: string };
  drop: { lat: number; lng: number; address: string };

  /**
   * The trip distance the QUOTE was priced against, frozen at booking time — not a live
   * recomputation from `pickup`/`drop`, and not the driver's actual GPS track, which this system
   * does not retain. Null only on a booking whose quote predates this field.
   */
  distance_km: number | null;

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
   * Whether this booking asked for the customer's favourite drivers to be rung first.
   *
   * The apps use it for one thing: while a booking is still SEARCHING with no driver, the wait
   * screen can say it is ringing the customer's own drivers rather than the generic line. It is
   * NOT a promise about who ends up on the trip — the favourite wave falls through to everyone
   * else within the minute — so no screen should render it as one after a driver is assigned.
   *
   * Always present, `false` on every booking made before favourites existed.
   */
  prefer_favourite_drivers: boolean;

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

  /** Charges decided after the quote — waiting time, extra days. Never edits `fare`. */
  adjustments: Array<{ type: string; label: string; amount: Money }>;

  /**
   * WHAT THE TRIP COSTS NOW — everything agreed so far, in one figure.
   *
   * `fare` is frozen at booking time (invariant B-1) and deliberately never moves, which is
   * correct for a receipt and wrong for a price. A day extension the driver agreed to, a waiting
   * charge, the customer's own wallet credit: all of them change what is actually owed and none
   * of them can touch `fare`. So the server does that arithmetic once, here, and both apps render
   * `total` rather than each re-deriving it — which is how the customer's screen and the driver's
   * "collect this much in cash" line came to disagree with each other and with the ledger.
   *
   * The components are all present so a screen can show a breakdown without a second endpoint,
   * and so the block visibly adds up: `total = fare_total + extension_total + waiting_total
   * − wallet_credit + wallet_debt`, floored at zero.
   */
  payable: {
    /** The frozen fare, repeated so this block stands on its own. Always equals `fare.total`. */
    fare_total: Money;
    /** Extra days the driver has ACCEPTED. Zero while a request is merely pending. */
    extension_total: Money;
    /** Waiting time beyond the free window. Zero until the trip has ended and it is known. */
    waiting_total: Money;
    wallet_credit: Money;
    wallet_debt: Money;
    total: Money;
    /**
     * Of `total`, what the customer still has to pay ONLINE right now — today only an accepted
     * extension that the booking order did not already cover.
     *
     * Zero on a cash trip, where everything is collected at the door, and zero when there is
     * nothing outstanding. Non-zero is the customer app's cue to show a pay button, and the
     * reason the driver cannot end the trip yet.
     */
    outstanding: Money;
  };

  /**
   * Buying another day on an outstation trip already under way.
   *
   * `null` ON EVERY BOOKING THAT IS NOT ONE — incity, not yet started, already finished. The apps
   * render the whole block or none of it, so a null is "there is nothing to say here" rather than
   * a state either of them has to reason about.
   *
   * `can_extend` IS THE SERVER'S ANSWER, not a hint. Five conditions decide it — started,
   * outstation, has a driver, has a frozen day rate, nothing already pending — and an app
   * re-deriving them is an app that eventually shows a button the server refuses. `reason` says
   * why not, in words meant for the customer.
   *
   * `pending` is the request waiting on the driver. While it is set the customer is waiting, not
   * charged: an extension costs nothing until the driver accepts, and nothing at all if they
   * decline or never answer.
   */
  extension: {
    can_extend: boolean;
    /** Null when `can_extend` is true. */
    reason: string | null;
    /** What one more day would cost, when there is a day rate to quote it from. */
    price: Money | null;
  pending: {
      id: string;
      amount: Money;
      expires_at: string;
      /**
       * What the DRIVER earns from this day. Present on a driver's read of their own trip and
       * `null` on the customer's, for the same reason the two phone numbers come and go: it is
       * the commission split, and a customer has no business being shown what their driver's cut
       * of a package is. The server decides, not the screen — a figure withheld cannot be read
       * out of a cached response.
       */
      driver_amount: Money | null;
    } | null;
    /** Extra days already agreed. `0` until a driver has accepted one. */
    extra_days: number;
    extra_amount: Money;
  } | null;

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

/**
 * `GET /admin/bookings` — every booking in the system, newest first, filtered and paged.
 *
 * THE ONLY BOOKING LIST THAT IS PAGED. The customer's and the driver's are one person's own
 * history capped at a limit; this one is the whole table and grows with the business, so a cap
 * would silently hide rows from the person whose job is to find them.
 *
 * `BookingDto` unchanged, like the other two lists — a management row and a trip receipt are one
 * object at two distances. Rows carry BOTH `customer` and `driver` as name-only, `phone: null`:
 * an admin list resolves names in one batched lookup per role and never the phone numbers, which
 * `PHONE_VISIBLE_STATUSES` reserves for the two people actually meeting at a kerb.
 */
export interface AdminBookingListDto {
  bookings: BookingDto[];
  pagination: {
    page: number;
    limit: number;
    total_items: number;
    total_pages: number;
  };
}

/**
 * The filters `GET /admin/bookings` accepts, as query params.
 *
 * SERVER-SIDE, and for the reason `LedgerQueryParams` gives: the list is paged, so a filter
 * applied in the client would only search the rows already fetched and would miss every match on
 * page two. Every field is optional; omitting all of them returns the whole table newest-first.
 */
export interface AdminListBookingsQuery {
  page?: number | undefined;
  limit?: number | undefined;
  /**
   * Matches a booking REFERENCE, or the name or mobile number of either party.
   *
   * The two halves are answered by different modules and unioned: `bookings` owns the reference,
   * and `identity` resolves a name or number to the account ids this module then filters on. That
   * indirection is the module boundary doing its job — `bookings` cannot read the accounts
   * collection, and the alternative is this module learning what a phone number is.
   */
  search?: string | undefined;
  /** Comma-separated `BookingStatus`es: `?status=ASSIGNED,STARTED`. */
  status?: string | undefined;
  /** `YYYY-MM-DD`, inclusive, IST — matched against `scheduled_at`. */
  from?: string | undefined;
  /** `YYYY-MM-DD`, INCLUSIVE of the whole day named. */
  to?: string | undefined;
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
