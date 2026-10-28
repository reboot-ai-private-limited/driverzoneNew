import type {
  BookingActorType,
  BookingPaymentStatus,
  BookingStatus,
  CarCategory,
  Direction,
  BookingPaymentMode,
  DispatchMode,
  ExtrasCollection,
  ServiceType,
  Terrain,
  VehicleTypePreference,
} from '@driverzone/contracts';
import type { FareBreakdown } from '../../pricing/pricing.public.js';

/**
 * DOMAIN — a booking, and the only legal ways it may move.
 *
 * INVARIANT B-3: every status change goes through one function, and no handler writes
 * `bookings.status` directly. That is what makes `bookingEvents` trustworthy — and the event log
 * is how every dispute, every "the driver never came" and every "I was charged for time I did not
 * use" gets answered eight weeks later.
 */

/**
 * Transcribed from docs/LLD/booking-lifecycle.md, with one change: `DRAFT` and `QUOTED` are gone
 * and `PENDING_PAYMENT` is the entry point.
 *
 * Those two described a customer who had not bought anything, and that state lives on the
 * `quotes` collection — a booking row now comes into existence only when the quote is consumed.
 *
 * `PENDING_PAYMENT → CONFIRMED` no longer waits on anything: `createBooking.usecase.ts` makes
 * that transition synchronously, in the same request, for every booking regardless of how it will
 * eventually be paid for — payment method is chosen later, once the ride has STARTED
 * (`selectPaymentMethod.usecase.ts`), and a driver is dispatched immediately rather than waiting
 * on it. The status is kept rather than collapsed away so the audit trail (`bookingEvents`) still
 * records the same first transition every booking has always had.
 */
export const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'EXPIRED', 'CANCELLED_BY_CUSTOMER'],
  CONFIRMED: ['SEARCHING', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_ADMIN'],
  /**
   * `WAITING_DRIVER` is reachable only from the EARLY ring of a scheduled booking — the final
   * ring at T−90 goes to `NO_DRIVER_FOUND` instead. Which of the two a wave exhaustion produces
   * is decided by the dispatch attempt, not by this table.
   */
  SEARCHING: [
    'ASSIGNED',
    'WAITING_DRIVER',
    'NO_DRIVER_FOUND',
    'CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_ADMIN',
  ],
  /**
   * THE ONE EDGE THAT MAKES THIS TABLE A LOOP RATHER THAN A FUNNEL, and the reason the claim race
   * needs testing rather than assuming.
   *
   * A parked booking re-enters `SEARCHING` three ways — the final ring at T−90, an admin
   * assigning by hand, or an eligible driver taking it off the scheduled board — and all three go
   * through `beginSearching` so that `claimForDriver`'s compare-and-swap keeps having exactly one
   * implementation. Everywhere else in this table a status is entered once; here it can be
   * entered twice for the same booking, hours apart.
   */
  WAITING_DRIVER: ['SEARCHING', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_ADMIN'],
  ASSIGNED: [
    'DRIVER_EN_ROUTE',
    'SEARCHING', // ← reassignment
    'CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_DRIVER',
    'CANCELLED_BY_ADMIN',
  ],
  DRIVER_EN_ROUTE: [
    'ARRIVED',
    'SEARCHING',
    'CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_DRIVER',
    'CANCELLED_BY_ADMIN',
  ],
  ARRIVED: [
    'STARTED',
    'SEARCHING',
    'CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_DRIVER',
    'CANCELLED_BY_ADMIN',
  ],
  STARTED: ['COMPLETED', 'CANCELLED_BY_ADMIN'], // admin only, and it is rare
  COMPLETED: [],
  NO_DRIVER_FOUND: ['SEARCHING'], // admin retry
  CANCELLED_BY_CUSTOMER: [],
  CANCELLED_BY_DRIVER: [],
  CANCELLED_BY_ADMIN: [],
  EXPIRED: [],
};

/**
 * Statuses that may not be reached without a reason.
 *
 * Every cancellation, `NO_DRIVER_FOUND`, and `SEARCHING` when it arrives from a reassignment. An
 * unexplained state change is one nobody can act on later — and these are precisely the ones
 * somebody will be asked about.
 */
export const REASON_REQUIRED: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN',
  'NO_DRIVER_FOUND',
  /*
   * Not terminal, but somebody will be asked about it. A parked booking is the row ops works from
   * between the two rings, and "why is this waiting" is the first question — the reason carries
   * how far the early search got before it ran out.
   */
  'WAITING_DRIVER',
]);

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A status from which nothing further can happen. */
export function isTerminal(status: BookingStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** The statuses in which a driver is committed to this trip and cannot take another. */
export const COMMITTED_STATUSES: readonly BookingStatus[] = [
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED',
  'STARTED',
];

/**
 * The statuses an admin may move a booking OFF its driver from.
 *
 * `COMMITTED_STATUSES` MINUS `STARTED`, and the missing one is the whole point. A trip already
 * under way cannot be handed to somebody else: the fare was quoted for one journey, the ledger
 * pays one driver for it, and the customer's receipt names one. Ops moving a started trip is a
 * cancellation and a new booking, and docs/LLD/dispatch-and-assignment.md says so explicitly —
 * blurring the two breaks all three of those at once.
 *
 * Derived from the list above rather than typed out again, so a status added to one is a
 * deliberate decision about the other rather than a copy somebody forgot.
 */
export const REASSIGNABLE_STATUSES: readonly BookingStatus[] = COMMITTED_STATUSES.filter(
  (status) => status !== 'STARTED',
);

export interface Actor {
  type: BookingActorType;
  /** Null for SYSTEM — a sweeper and a wave timeout have no person behind them. */
  id: string | null;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** The person in the car when the customer booked for someone else. `phone` is E.164. */
export interface BookingRider {
  name: string;
  phone: string;
}

/**
 * What the customer agreed to, frozen at confirmation and never edited (invariant B-1).
 *
 * `source` records WHY this price was charged, which is what a dispute needs when the packages
 * have since been reorganised. Every later charge — waiting, a late fine, a cancellation fee — is
 * its own row elsewhere and never an edit here.
 */
export interface FareSnapshot {
  version: 1;
  serviceType: ServiceType;
  computedAt: Date;
  source: {
    packageId: string;
    packageName: string;
    variantId: string | null;
    variantLabel: string | null;
    pickupZoneId: string;
    pickupZoneName: string;
    cityZoneId: string | null;
    cityName: string | null;
    terrain: Terrain | null;
  };
  included: { minutes: number | null };
  fare: FareBreakdown;
}

export interface Booking {
  id: string;
  /** `DZ-8F3K2M`. What a customer reads out to support; never the ObjectId. */
  reference: string;
  customerId: string;
  driverId: string | null;
  status: BookingStatus;
  serviceType: ServiceType;

  pickup: GeoPoint;
  pickupAddress: string;
  drop: GeoPoint;
  dropAddress: string;
  direction: Direction | null;
  distanceKm: number | null;

  /**
   * The car this trip is for, and how it is driven — the two competencies dispatch matches a
   * driver against. Null only on bookings placed before the choice existed (2026-09-02), which
   * the eligibility query reads as "no requirement", never as "a requirement no one meets".
   */
  carCategory: CarCategory | null;
  vehicleType: VehicleTypePreference | null;

  /**
   * The customer's number plate for this trip, copied from their profile when the booking was
   * made. A copy, not a reference: editing or deleting the car later must not change which car a
   * past trip was in. Null on bookings made before plates were recorded (2026-10-13).
   */
  plateNumber: string | null;

  /**
   * The passenger, when the customer booked for someone else (2026-10-28). Null when the customer
   * is travelling themselves. Frozen at booking time like the plate — the person in the car does
   * not change because the booker later edits a contact.
   */
  rider: BookingRider | null;

  /**
   * The customer asked for their favourite drivers to be rung before anybody else.
   *
   * A PREFERENCE, NOT A RESTRICTION, and the distinction is the whole design: dispatch rings the
   * favourites as wave 0 and then falls through to the ordinary radius ladder the moment they
   * decline, ignore, or turn out to be ineligible. No booking is ever left without a driver
   * because a favourite was busy.
   *
   * STORED ON THE BOOKING rather than read off the customer at dispatch time, because it is a
   * decision the customer made about THIS trip. The list of favourites it resolves against is
   * read live — that one is a preference about people, and the newest answer is the right one.
   *
   * False on every booking made before favourites existed, which is the correct reading: nobody
   * asked for it.
   */
  preferFavouriteDrivers: boolean;

  /**
   * `MANUAL` — booked by an admin from the panel on the customer's behalf, and NOBODY IS RUNG for
   * it. The admin assigns a driver by hand (`TransferBookingUseCase`). Both doors into automatic
   * dispatch are shut for it: the sweeper's `findDueForDispatch` skips it, and `RunWaveUseCase`
   * refuses it — the second guard covers a job enqueued before the mode was set.
   *
   * `AUTO` on every customer booking, and on every row written before this field existed.
   */
  dispatchMode: DispatchMode;

  /**
   * What the customer's wallet did to this trip's price, frozen at creation.
   *
   * STORED, NOT RECOMPUTED. The balance moves — a later fine, a later grant — so asking the wallet
   * again at completion would produce a different answer from the one the customer agreed to and
   * the one the payment intent was raised for. These two are what actually happened to THIS
   * booking, and `expectedCashPaise` and the invoice both read them.
   *
   * Both are non-negative. `walletCreditPaise` came off the fare; `walletDebtPaise` was added to
   * it. They are never both positive: a balance is either a credit or a debt.
   */
  walletCreditPaise: number;
  walletDebtPaise: number;

  quoteId: string;
  fareSnapshot: FareSnapshot;
  /**
   * How this trip is paid for. Null from booking creation until the customer selects a payment
   * method after the trip has STARTED — except on an admin booking, where the admin sets `CASH` or
   * `PREPAID` up front.
   */
  paymentMode: BookingPaymentMode | null;
  paymentStatus: BookingPaymentStatus;
  paymentId: string | null;
  /** How a `PREPAID` booking was paid, as the admin noted it. Null on every other booking. */
  paymentReference: string | null;
  /**
   * How the trip's extras were settled when the driver ended it — cash, online, or left unpaid as
   * the customer's dues. Null until completion, and when there was nothing extra to settle.
   */
  extrasCollection: ExtrasCollection | null;
  /**
   * How much of an already-accepted day extension was folded into the UPI order at payment
   * selection time — zero for a cash booking, or a UPI one selected before any extension was
   * accepted. `CompleteTripUseCase` reads this to avoid billing the same extension twice: once
   * here, in the booking-confirmation charge, and again in the completion settlement.
   */
  paidExtensionPaise: number;
  /**
   * How much of `paidExtensionPaise` the DRIVER took in cash on a trip that is otherwise UPI.
   *
   * THE WAY OUT OF THE EXTENSION GATE. `CompleteTripUseCase` refuses to end a UPI trip whose
   * extra day has not been paid for, and `DriverSwitchToCashUseCase` — the usual escape from a
   * payment gate — cannot help here, because it refuses a booking whose fare has already been
   * paid online, which is exactly the trip this happens on. A customer whose phone has died owes
   * the driver a day and has no way to send it; this is the driver saying they took it in hand.
   *
   * RECORDED SEPARATELY FROM `paidExtensionPaise` rather than inferred from it, because the
   * ledger needs to tell the two apart: money that reached the company through the gateway leaves
   * the driver owing nothing, while money in the driver's pocket is the company's and comes back
   * as a negative `CASH_COLLECTED` row, the same way a cash fare does.
   *
   * Zero on every ordinary trip, including an all-cash one — there the whole fare is already
   * booked as cash collected, and counting the extension again would double it.
   */
  cashExtensionPaise: number;

  /** True when the pickup is far enough out that dispatch waits rather than searching now. */
  isScheduled: boolean;
  scheduledAt: Date;
  /** When dispatch should start looking. `now` for an immediate booking, T−lead for a scheduled one. */
  dispatchAt: Date;

  assignedAt: Date | null;
  enRouteAt: Date | null;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;

  /** Measured from ARRIVED to STARTED and settled after the trip. */
  waitingMinutes: number | null;
  waitingChargePaise: number | null;
  /** How late the driver was against `scheduledAt`. Recorded even when under the grace period. */
  driverLateMinutes: number | null;

  /** Wrong-OTP attempts. At five the booking locks and routes to support. */
  otpAttempts: number;

  createdAt: Date;
  updatedAt: Date;
}

/** Five wrong codes and the driver is talking to a human instead. */
export const MAX_OTP_ATTEMPTS = 5;

/**
 * A booking whose pickup is further out than this waits rather than dispatching immediately, and
 * earns the scheduled cancellation window.
 *
 * **ZERO: ANY PICKUP IN THE FUTURE IS SCHEDULED.** This was 60, and the hour was a trap rather
 * than a saving. A trip booked at 2:05 for 2:35 fell under it and became an *immediate* booking
 * carrying a 2:35 pickup time — rung at once, driver at the kerb by 2:20, and, because every
 * scheduled-booking protection keys off this flag, the twenty minutes they then sat there were
 * billable waiting time against a customer who had asked for 2:35 and got exactly that.
 * `computeWaitingCharge` exempts a scheduled trip until shortly before its pickup; the flag was
 * the only thing standing between that rule and the trip it was written for.
 *
 * NOTHING DISPATCHES LATER BECAUSE OF THIS. `createBooking` sets `dispatchAt` to
 * `max(now, scheduledAt − lead)`, so a pickup inside the lead window still starts looking
 * immediately — the change is that the booking now *knows* it is scheduled, which is what the
 * waiting exemption, the cancellation window, the driver's Upcoming list and `attemptFor`'s
 * EARLY/FINAL split all read.
 *
 * AN INSTANT BOOKING IS STILL INSTANT. "Now" sends no `scheduledAt`, so the server stamps the
 * quote's own creation time — always in the past by the time the booking is made, never greater
 * than `now`, and therefore never scheduled.
 */
export const SCHEDULED_THRESHOLD_MINUTES = 0;

export function isScheduledBooking(scheduledAt: Date, now: Date): boolean {
  return scheduledAt.getTime() > now.getTime() + SCHEDULED_THRESHOLD_MINUTES * 60_000;
}

/**
 * How near a pickup has to be before an ASSIGNED booking counts as the trip a driver is ON.
 *
 * A driver can hold a booking days ahead of time — an admin assigns one directly from the panel
 * rather than waiting for the automatic search. Treating that as their current trip would re-route
 * them onto it on every app launch until the pickup day and block them from all other work, so
 * `findActiveForDriver` fences it off with this instant.
 *
 * THE SAME DIAL AS AUTOMATIC DISPATCH (`dispatch.scheduled_lead_minutes`), deliberately: a
 * pre-assigned trip becomes live at exactly the moment dispatch would otherwise have started
 * ringing for it. One number to turn, and the two paths cannot drift into disagreeing about when
 * a scheduled booking stops being "later" and starts being "now".
 */
export function liveAssignmentCutoff(now: Date, leadMinutes: number): Date {
  return new Date(now.getTime() + leadMinutes * 60_000);
}

/**
 * `DZ-` plus six characters from an alphabet with no `0`/`O` and no `1`/`I`.
 *
 * These are read aloud down a phone line to support, which is the whole reason for the exclusions
 * and for using uppercase only.
 */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateReference(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += REFERENCE_ALPHABET[Math.floor(random() * REFERENCE_ALPHABET.length)];
  }
  return `DZ-${out}`;
}
