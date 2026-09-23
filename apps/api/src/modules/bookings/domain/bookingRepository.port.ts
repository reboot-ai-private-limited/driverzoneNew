import type { BookingStatus } from '@driverzone/contracts';
import type { Actor, Booking, FareSnapshot, GeoPoint } from './booking.entity.js';

export interface NewBooking {
  reference: string;
  customerId: string;
  quoteId: string;
  serviceType: Booking['serviceType'];
  pickup: GeoPoint;
  pickupAddress: string;
  drop: GeoPoint;
  dropAddress: string;
  direction: Booking['direction'];
  distanceKm: number | null;
  carCategory: Booking['carCategory'];
  vehicleType: Booking['vehicleType'];
  preferFavouriteDrivers: boolean;
  walletCreditPaise: number;
  walletDebtPaise: number;
  fareSnapshot: FareSnapshot;
  paymentMode: Booking['paymentMode'];
  isScheduled: boolean;
  scheduledAt: Date;
  dispatchAt: Date;
  /** Hashed before storage is NOT wanted here — see `booking.model.ts` on why it is plaintext. */
  startOtp: string;
}

export interface BookingEvent {
  id: string;
  bookingId: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  actorType: Actor['type'];
  actorId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** Fields a transition may set alongside the status. Nothing else may be written with one. */
export interface TransitionPatch {
  driverId?: string | null;
  /** Nullable, so an admin reassignment can clear it — see `releaseDriver`. */
  assignedAt?: Date | null;
  enRouteAt?: Date;
  arrivedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  waitingMinutes?: number;
  waitingChargePaise?: number;
  driverLateMinutes?: number;
  paymentId?: string;
}

/**
 * What the admin booking table filters on. Every field is optional; an empty filter is the whole
 * collection, newest first.
 */
export interface AdminBookingFilter {
  page: number;
  limit: number;
  /** Matched against the booking REFERENCE only. Names and numbers arrive as `accountIds`. */
  search?: string | undefined;
  /**
   * Accounts — customers or drivers — that `identity` matched to the same search term. Present
   * only when there was a term; an EMPTY ARRAY is meaningful and means "the term matched nobody",
   * which must not widen the query back to everything.
   */
  accountIds?: readonly string[] | undefined;
  statuses?: readonly BookingStatus[] | undefined;
  /** Inclusive lower bound on `scheduledAt`. */
  from?: Date | undefined;
  /** EXCLUSIVE upper bound on `scheduledAt` — the caller passes the start of the following day,
   * so that "to 18 May" includes everything that happened during the 18th. */
  before?: Date | undefined;
}

export interface BookingRepositoryPort {
  create(data: NewBooking): Promise<Booking>;

  findById(id: string): Promise<Booking | null>;
  findByQuoteId(quoteId: string): Promise<Booking | null>;
  findByPaymentId(paymentId: string): Promise<Booking | null>;
  listForCustomer(customerId: string, limit: number): Promise<Booking[]>;

  /**
   * Every booking this driver was assigned, newest first — their trip history.
   *
   * FILTERED ON `driverId`, which is set exactly once and only by dispatch's claim (invariant
   * B-2). That is what makes this list honest without a status filter: a booking a driver was rung
   * for and lost never had their id written to it, so it cannot appear here, and a trip that was
   * cancelled after they accepted it correctly does.
   */
  listForDriver(driverId: string, limit: number): Promise<Booking[]>;

  /**
   * The admin booking table: every booking, newest first, filtered and PAGED.
   *
   * The only list read here that returns a total, because it is the only one with pages to count.
   * `listForCustomer` and `listForDriver` are one person's history behind a cap; this is the whole
   * collection, and an admin filtering it needs to know whether they matched ten rows or ten
   * thousand before they decide the filter was wrong.
   *
   * `accountIds` is how a name or mobile search arrives — already resolved to ids by `identity`,
   * because this module cannot read the accounts collection (see `AccountDirectoryContract`).
   * A booking matches if its reference matches the term OR either party is one of those ids, so
   * the two halves union rather than intersect: searching "Rahul" must find bookings where Rahul
   * is the driver as well as ones where he is the customer.
   */
  listForAdmin(filter: AdminBookingFilter): Promise<{ bookings: Booking[]; totalItems: number }>;

  /**
   * Reads the OTP, which every other read deliberately cannot see (`select: false` on the field).
   * Separate method so that reaching for it is a visible act at the call site.
   */
  readStartOtp(id: string): Promise<string | null>;

  incrementOtpAttempts(id: string): Promise<number>;

  /**
   * Links the booking to the payment being collected for it.
   *
   * Not part of `transition()` because it changes no status — the booking is at PENDING_PAYMENT
   * before and after. B-3 governs the status field alone.
   */
  attachPayment(id: string, paymentId: string): Promise<void>;

  /**
   * Sets the customer's chosen payment method (CASH or UPI) after the ride has STARTED.
   */
  setPaymentMode(
    id: string,
    mode: Booking['paymentMode'],
    status?: Booking['paymentStatus'],
  ): Promise<Booking | null>;

  /**
   * Updates the payment status on the booking (e.g. when an online payment captures).
   */
  setPaymentStatus(id: string, status: Booking['paymentStatus']): Promise<Booking | null>;

  /**
   * Records how much of an already-accepted day extension rode along in the UPI order created at
   * payment-selection time, so `CompleteTripUseCase` can settle only the remainder.
   */
  setPaidExtensionPaise(id: string, amountPaise: number): Promise<void>;

  /**
   * Adds to that figure when a separate extras order captures — the extension the customer bought
   * AFTER they had already paid for the trip, which the booking order could not have covered.
   *
   * AN INCREMENT, NOT A SET, unlike the one above. That one runs once, at payment selection, and
   * knows the whole accepted total. This one runs per captured order, possibly more than once on a
   * trip extended twice, and each capture only knows its own amount — writing the absolute figure
   * from a webhook that arrives out of order would erase the other one.
   */
  addPaidExtensionPaise(id: string, amountPaise: number): Promise<void>;

  /**
   * The driver took the extra day in cash on an otherwise-UPI trip — see `Booking.cashExtensionPaise`.
   *
   * Adds to BOTH counters, which is why it is its own method rather than a second call to the one
   * above: the money has been collected (so the completion gate opens) AND the driver is holding
   * it (so the ledger owes the company its share back).
   */
  addCashExtensionPaise(id: string, amountPaise: number): Promise<Booking | null>;

  /**
   * THE ONE WAY A STATUS CHANGES (invariant B-3).
   *
   * Compare-and-swap on `from`, plus the `bookingEvents` insert, in one multi-document
   * transaction. Returns `null` when the booking was not in `from` — someone else moved it first,
   * which is the ordinary result of a customer cancelling as a driver accepts, not an error.
   *
   * The docs write this in Postgres with `SELECT … FOR UPDATE`; a conditional update is the
   * better primitive here, since it holds no lock and cannot deadlock.
   */
  transition(input: {
    bookingId: string;
    from: BookingStatus;
    to: BookingStatus;
    actor: Actor;
    reason?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    patch?: TransitionPatch | undefined;
  }): Promise<Booking | null>;

  /**
   * THE ACCEPT RACE. `driverId: null` and `status: 'SEARCHING'` are both in the FILTER, so five
   * drivers tapping Accept at once produce exactly one winner and four clean losses.
   *
   * Separate from `transition()` because it swaps on two fields rather than one, and because it
   * is the single place invariant B-2 lives: `driverId` goes from null to non-null exactly once.
   * Returns `null` when the race was lost.
   *
   * `actor` OMITTED means what it always has: the driver claimed their own offer, and the
   * resulting event says so (`actorType: 'DRIVER'`). Manual assignment is the one caller that
   * claims on someone else's behalf and must say so instead — see `TransferBookingUseCase`.
   */
  claimForDriver(
    bookingId: string,
    driverId: string,
    actor?: (Actor & { reason?: string }) | undefined,
  ): Promise<Booking | null>;

  /**
   * The one trip this driver is in the middle of, or null.
   *
   * THE RECOVERY PATH. A driver's app is killed mid-trip constantly — the OEM battery managers on
   * Xiaomi, Oppo, Vivo and Realme are what `battery-setup` exists to fight — and the booking id
   * lived only in the app's navigation state, which dies with the process. Without this read there
   * is no question the app can ask to find its way back, and the driver is left unable to arrive,
   * start or complete a trip the customer is waiting on. `GET /driver/offers` is the same
   * idea for a ringing offer; this is its equivalent for a trip already won.
   *
   * NEWEST FIRST, AND THAT IS LOAD-BEARING — a driver really can hold several live bookings at
   * once today. `MongoDriverPool` filters candidates on duty, verification, blocked, location
   * freshness and wallet balance, and on nothing about whether they are already driving someone:
   * a driver mid-trip is still eligible and can be rung and accept. Until dispatch excludes busy
   * drivers, "the one they are on" is ambiguous, and the newest is the only answer that matches
   * what the driver just did. Returning an arbitrary one would send them back to a trip they
   * finished with.
   *
   * `assignedPickupBefore` FENCES OFF A TRIP THAT HAS NOT COME ROUND YET. An admin can hand a
   * driver a booking days in advance (`TransferBookingUseCase`), and without this that booking is
   * "the trip they are on" from the moment it is assigned — `gate.tsx` would re-route them onto it
   * on every app launch until the pickup day, and `hasActiveBooking` would refuse them all other
   * work in the meantime. So an `ASSIGNED` booking only counts once its pickup is within the
   * caller's window: the same instant automatic dispatch would have begun ringing for it.
   *
   * ONLY `ASSIGNED` IS FENCED. A driver who has set off, arrived, or started is on the trip
   * whatever the clock says — a wrong `scheduledAt` must never strand a ride that is happening.
   * Omitting the window restores the old behaviour, which is what a caller that is asking "does
   * this driver hold anything at all" wants.
   */
  findActiveForDriver(
    driverId: string,
    assignedPickupBefore?: Date | undefined,
  ): Promise<Booking | null>;

  /**
   * The booking this customer is living through right now, or null.
   *
   * The customer's half of the same recovery problem, and it costs them more than it costs a
   * driver: `showsStartOtp` puts the trip code on the LIVE trip screen only, so a customer whose
   * app restarted at the pickup could not reach the four digits their driver needs to start —
   * the history screen is a receipt and deliberately carries neither the code nor the cancel bar.
   *
   * A NARROWER SET THAN "not terminal", and the difference is `CONFIRMED`. A scheduled booking
   * sits at CONFIRMED until its dispatch time, so counting it here would drag a customer into a
   * trip booked for tomorrow every time they opened the app. `PENDING_PAYMENT` is out for the
   * same kind of reason: an abandoned checkout is not something to reopen unasked. What is left
   * is the set where something is actually happening to them now.
   *
   * `assignedPickupBefore` CLOSES THE HOLE THAT EXCLUDING `CONFIRMED` LEFT. Excluding it was
   * enough while a scheduled booking could only reach `ASSIGNED` at T−90, because by then the trip
   * genuinely was about to happen. Ops can now pre-assign one days ahead, which walks it straight
   * past that guard and back into "Trip in progress" on the customer's home screen for three days
   * — the same complaint, one status further along. Same window as the driver's side, and only
   * `ASSIGNED` is fenced: `SEARCHING` means we are ringing phones right now, and the three moving
   * statuses speak for themselves.
   */
  findActiveForCustomer(
    customerId: string,
    assignedPickupBefore?: Date | undefined,
  ): Promise<Booking | null>;

  listEvents(bookingId: string): Promise<BookingEvent[]>;

  /** Bookings whose `dispatchAt` has passed and are still waiting. The sweeper's safety net. */
  findDueForDispatch(now: Date, limit: number): Promise<Booking[]>;

  /** Bookings stuck at PENDING_PAYMENT past a cutoff, for expiry. */
  findAbandonedPayments(before: Date, limit: number): Promise<Booking[]>;

  /**
   * Has this pair actually finished a trip together?
   *
   * EXISTENCE, NOT A LIST, because that is the whole question `favourites` asks: a customer may
   * only favourite a driver who has really driven them. Returning the bookings instead would hand
   * a caller outside this module a set of trips it has no business reading, and would cost more
   * to answer — this one stops at the first match.
   */
  hasCompletedTripTogether(customerId: string, driverId: string): Promise<boolean>;

  /**
   * Does this customer or driver hold any booking in a non-terminal status? Existence only, for
   * account deletion — see `BookingAccountContract` on why this is wider than "active".
   */
  hasOpenBooking(party: 'CUSTOMER' | 'DRIVER', accountId: string): Promise<boolean>;
}
