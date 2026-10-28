import type { Actor, Booking } from './domain/booking.entity.js';

/**
 * PUBLIC CONTRACT — the only surface other modules may import from `bookings`.
 *
 * `dispatch` is the consumer, and the split below is the point. It may READ a booking and it may
 * CLAIM one for a driver — and it may do nothing else, in particular nothing that moves a booking
 * through the trip. `dispatch` is also the ONLY module permitted to set `bookings.driverId`, a
 * rule `.dependency-cruiser.cjs` enforces by tier and this interface enforces by shape.
 */

/** The outcome of a driver accepting an offer. Losing is a normal result, not an error. */
export type ClaimResult =
  | { claimed: true; booking: Booking }
  /**
   * Another driver won. This must NEVER count against the loser's acceptance rate — they did
   * everything right and were merely slower.
   */
  | { claimed: false; reason: 'ALREADY_ASSIGNED' }
  | { claimed: false; reason: 'NOT_SEARCHING' }
  | { claimed: false; reason: 'NOT_FOUND' };

export interface BookingDispatchContract {
  findById(bookingId: string): Promise<Booking | null>;

  /**
   * Moves CONFIRMED → SEARCHING when the dispatch job fires.
   *
   * ALSO THE DOOR MANUAL PRE-ASSIGNMENT COMES THROUGH. An admin handing a driver a booking that
   * has not dispatched yet needs it in `SEARCHING` before `claimForDriver`'s compare-and-swap will
   * look at it, and this is that move — rather than a second way to write `ASSIGNED` onto a
   * `CONFIRMED` booking, which would put a hole in the transition table and in invariant B-2.
   */
  /**
   * `from` IS EXPLICIT because the compare-and-swap is the point.
   *
   * Two statuses are driverless and may start a search: `CONFIRMED`, which has never been looked
   * at, and `WAITING_DRIVER`, whose early ring found nobody. Reading the status here and then
   * transitioning would open a window between the read and the write; naming it lets the update
   * itself be the guard, so two callers racing to start the final ring resolve to one winner.
   */
  beginSearching(
    bookingId: string,
    from: 'CONFIRMED' | 'WAITING_DRIVER',
  ): Promise<Booking | null>;

  /**
   * The early ring found nobody, and the booking is parked rather than given up on.
   *
   * ONLY EVER REACHED FROM THE EARLY ATTEMPT of a scheduled booking. The final ring at T−90 calls
   * `markNoDriverFound` instead — same exhaustion, different meaning, because by then there is no
   * later search to wait for. Requires a reason for the same purpose the terminal states do: this
   * is a state somebody in ops will be asked about.
   */
  markWaitingForDriver(bookingId: string, reason: string): Promise<Booking | null>;

  /**
   * The accept race, as one conditional update: `driverId: null` AND `status: SEARCHING` are both
   * in the filter, so exactly one of five simultaneous accepts can win.
   *
   * `actor` OMITTED means the driver claimed their own offer, exactly as before. Manual
   * assignment passes `{ type: 'ADMIN', id, reason }` so the resulting event names who actually
   * put the driver on the trip, instead of naming the driver.
   */
  claimForDriver(
    bookingId: string,
    driverId: string,
    actor?: (Actor & { reason?: string }) | undefined,
  ): Promise<ClaimResult>;

  /**
   * ADMIN REASSIGNMENT, first half: takes the trip off its current driver and returns it to
   * `SEARCHING` with `driverId` back to null.
   *
   * THE SECOND HALF IS `claimForDriver`, UNCHANGED. That method already refuses anything but a
   * `SEARCHING` booking with no driver, which is exactly the state this one produces — so a
   * manual transfer is release-then-claim rather than a third way to write `driverId`, and the
   * one compare-and-swap that guarantees invariant B-2 stays the only one there is.
   *
   * If the claim then loses to a dispatch wave that landed in the gap, the booking is `SEARCHING`
   * and dispatch carries on. The failure mode is "ops's pick did not stick", never a lost trip.
   *
   * Refuses anything but `ASSIGNED`, `DRIVER_EN_ROUTE` and `ARRIVED` — a `STARTED` trip is not
   * reassignable, it is a cancellation plus a new booking
   * (docs/LLD/dispatch-and-assignment.md §Reassignment).
   */
  releaseDriver(bookingId: string, reason: string, adminId: string): Promise<Booking | null>;

  /**
   * Is this driver already committed to a trip?
   *
   * Manual assignment is the one path that bypasses `MongoDriverPool`, and the pool is where every
   * other eligibility question is answered. This is the one of those questions that still has to
   * be asked — handing an admin a driver who is mid-trip is how one person ends up owing two
   * customers a journey at the same time.
   */
  hasActiveBooking(driverId: string): Promise<boolean>;

  /** No driver was found after every wave. Requires a reason, like every terminal state. */
  markNoDriverFound(bookingId: string, reason: string): Promise<Booking | null>;

  /** Bookings whose dispatch time has passed and are still waiting — the sweeper's safety net. */
  findDueForDispatch(now: Date, limit: number): Promise<Booking[]>;

  /** Parked bookings with a pickup still ahead of them — what the scheduled board is built from. */
  findWaitingForDriver(after: Date, limit: number): Promise<Booking[]>;

  /**
   * Trips this driver already holds and has not started, for the clash check on the board.
   *
   * `hasActiveBooking` cannot answer this: it asks "are they on a trip now", which is false for a
   * driver who holds Tuesday 10:00 and is sitting at home on Monday. Taking 10:00 and 10:30 on the
   * same morning is the failure this exists to prevent.
   */
  findUpcomingAssignedForDriver(driverId: string, after: Date): Promise<Booking[]>;
}

/**
 * Read-only, for a module that needs to know a trip happened and who was on it.
 *
 * Split from `BookingDispatchContract` rather than reusing it, for the same Interface Segregation
 * reason `identity.public.ts` splits its read and write sides: `reviews` needs one lookup, and
 * handing it the dispatch contract would hand it `claimForDriver` — the one method in this module
 * with a race in it — for no reason. The tier list says reviews may import bookings; this says
 * what it may do once it has.
 */
export interface BookingReviewContract {
  findById(bookingId: string): Promise<Booking | null>;
}

/**
 * For `invoices`: the same read-only question as `BookingReviewContract` — is this trip finished,
 * and whose is it — under its own name so the two consumers can drift apart without either
 * reaching through the other's contract.
 */
export type BookingInvoiceContract = BookingReviewContract;

/**
 * One question, for `favourites`: have this customer and this driver finished a trip together?
 *
 * ITS OWN CONTRACT, and it deliberately cannot answer anything else. A customer may only
 * favourite a driver who has really driven them — without that rule
 * `POST /customer/favourite-drivers` would tell anyone holding a customer token whether an
 * arbitrary driver id exists, and then hand back that driver's name and face. Enforcing it needs
 * exactly this boolean and nothing else, so this is exactly what `favourites` is given.
 */
export interface BookingFavouritesContract {
  hasCompletedTripTogether(customerId: string, driverId: string): Promise<boolean>;
}

/**
 * One question, for `accounts`: does this person still have a trip that is not finished?
 *
 * "Not finished" is every non-terminal status, including a CONFIRMED booking for next week and a
 * PENDING_PAYMENT checkout — WIDER than `findActiveForCustomer`, on purpose. That one asks what to
 * show on a home screen; this asks whether closing the account would strand a trip somebody is
 * counting on. A booking for Saturday is exactly the case that must stop a deletion.
 */
export interface BookingAccountContract {
  hasOpenBooking(party: 'CUSTOMER' | 'DRIVER', accountId: string): Promise<boolean>;
}

export type BookingsPublicContract = BookingDispatchContract;

export type { Booking, FareSnapshot, GeoPoint } from './domain/booking.entity.js';
export { COMMITTED_STATUSES, REASSIGNABLE_STATUSES } from './domain/booking.entity.js';
