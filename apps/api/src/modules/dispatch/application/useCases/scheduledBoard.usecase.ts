import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { Booking, BookingDispatchContract } from '../../../bookings/bookings.public.js';
import type { AssignableDriversContract } from '../../../identity/identity.public.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { OfferRepositoryPort } from '../../domain/ports.js';
import { requirementFromBooking, vehicleMismatchReason } from '../../domain/vehicleCompatibility.js';

/**
 * THE SCHEDULED BOARD — trips nobody took, offered to any driver who could do them.
 *
 * The middle of docs/LLD/dispatch-and-assignment.md §Ring early, park, ring again. A scheduled
 * booking is rung for when it is made; if nobody answers it parks in `WAITING_DRIVER` rather than
 * dying, and sits here until a driver takes it, ops assigns one, or the final ring at T−90.
 *
 * **BROWSING, NOT RINGING, AND THE DIFFERENCE IS THE POINT.** An offer interrupts a driver,
 * expires in forty-five seconds and counts against their acceptance rate if they ignore it. This
 * asks nothing of anybody: a driver opens it when they are planning their week, and a trip they
 * scroll past costs them nothing. That is what makes it safe to show a 6 am trip at 9 pm, which
 * the dispatch design is otherwise careful never to do.
 *
 * **ELIGIBILITY IS THE POOL'S, MINUS DISTANCE.** Verified, unblocked, and competent for the car
 * this trip needs — the same gates `MongoDriverPool` applies to a wave, because a board that let a
 * hatchback driver take an SUV booking would just move the problem to the pickup. Distance is
 * deliberately NOT among them: a wave asks who is near the pickup *now*, and "now" is days away
 * from a trip on this board. Where a driver happens to be on Monday says nothing about Thursday.
 */

/**
 * How long either side of a trip must be clear before another can be taken.
 *
 * Trips do not end where they start. A driver finishing a drop across town at 10:45 cannot be at
 * a different pickup at 10:45, and a board that let them promise both would produce exactly the
 * failure the whole scheduled flow exists to avoid: a customer waiting for somebody who is not
 * coming, discovered at the pickup.
 *
 * Deliberately generous, and deliberately not a routing calculation. Half an hour is a number a
 * driver can hold in their head and a support agent can explain; an ETA between two future points
 * would be a guess wearing a decimal point.
 */
const CLASH_BUFFER_MINUTES = 30;

/**
 * How long a trip is assumed to run when the quote never said.
 *
 * `fareSnapshot.included.minutes` is null on bookings whose package had no included time, and a
 * missing duration must not read as a zero-length trip — that would let a driver stack bookings
 * back to back on the strength of a field that was simply absent.
 */
const ASSUMED_TRIP_MINUTES = 120;

function tripWindow(booking: Booking): { start: number; end: number } {
  const start = booking.scheduledAt.getTime();
  const minutes = booking.fareSnapshot.included.minutes ?? ASSUMED_TRIP_MINUTES;
  return { start, end: start + minutes * 60_000 };
}

/** Do these two trips, plus the buffer either side, overlap at all? */
export function tripsClash(a: Booking, b: Booking, bufferMinutes = CLASH_BUFFER_MINUTES): boolean {
  const first = tripWindow(a);
  const second = tripWindow(b);
  const buffer = bufferMinutes * 60_000;
  return first.start - buffer < second.end && second.start - buffer < first.end;
}

export class ScheduledBoardUseCase {
  constructor(
    private readonly bookings: BookingDispatchContract,
    private readonly drivers: AssignableDriversContract,
    private readonly offers: OfferRepositoryPort,
    private readonly notifications: NotificationsContract,
  ) {}

  /**
   * What this driver may take.
   *
   * The clash check runs HERE as well as on accept, and the duplication is on purpose: showing a
   * driver a trip they will be refused is a worse experience than not showing it, and checking it
   * only on accept would do exactly that. The one on accept is the authority — this is courtesy.
   */
  async list(driverId: string, limit = 50): Promise<Booking[]> {
    const driver = await this.drivers.assignableDriverById(driverId);
    // Unverified, blocked, or not a driver at all. An empty board, not an error: there is nothing
    // useful to say here that the onboarding screens have not already said better.
    if (driver === null) return [];

    const now = new Date();
    const [parked, held] = await Promise.all([
      this.bookings.findWaitingForDriver(now, limit),
      this.bookings.findUpcomingAssignedForDriver(driverId, now),
    ]);

    return parked.filter((booking) => {
      if (vehicleMismatchReason(driver, requirementFromBooking(booking)) !== null) return false;
      return !held.some((existing) => tripsClash(booking, existing));
    });
  }

  /**
   * Take one.
   *
   * THE SAME TWO MOVES AS EVERY OTHER ASSIGNMENT — `beginSearching` then `claimForDriver` — so the
   * transition table, the event log and invariant B-2 keep having one implementation each. A
   * driver taking a trip off this board is not a special path into `ASSIGNED`; it is the ordinary
   * path with a different actor.
   *
   * `claimed: false` IS A NORMAL OUTCOME, not an error, exactly as on a ringing offer. Two drivers
   * can be looking at this board at the same moment, and the one who taps second has done nothing
   * wrong. Over a window measured in days rather than seconds, this will happen.
   */
  async accept(
    bookingId: string,
    driverId: string,
  ): Promise<
    | { claimed: true; booking: Booking }
    | { claimed: false; reason: string; message: string }
  > {
    const driver = await this.drivers.assignableDriverById(driverId);
    if (driver === null) {
      throw AppError.forbidden('Your account cannot take trips yet.');
    }

    const booking = await this.bookings.findById(bookingId);
    if (booking === null) throw AppError.notFound('That trip does not exist.');

    /*
     * CHECKED BEFORE ANYTHING IS WRITTEN. `beginSearching` moves the booking out of the parked
     * state, and a refusal after that point would leave it in `SEARCHING` with nobody searching —
     * a booking the board no longer lists and the final ring has not reached yet.
     */
    if (booking.status !== 'WAITING_DRIVER') {
      return {
        claimed: false,
        reason: `booking is ${booking.status}`,
        message:
          booking.status === 'ASSIGNED'
            ? 'Another driver has already taken this trip.'
            : 'This trip is no longer available.',
      };
    }

    if (booking.scheduledAt.getTime() <= Date.now()) {
      return {
        claimed: false,
        reason: 'pickup already passed',
        message: 'This trip’s pickup time has already passed.',
      };
    }

    const mismatch = vehicleMismatchReason(driver, requirementFromBooking(booking));
    if (mismatch !== null) {
      return {
        claimed: false,
        reason: `vehicle mismatch: ${mismatch}`,
        message:
          mismatch === 'HILL'
            ? 'This trip needs a driver verified for hill driving.'
            : 'This trip needs a different type of vehicle.',
      };
    }

    const held = await this.bookings.findUpcomingAssignedForDriver(driverId, new Date());
    const clashing = held.find((existing) => tripsClash(booking, existing));
    if (clashing !== undefined) {
      return {
        claimed: false,
        reason: `clashes with ${clashing.reference}`,
        message: `This clashes with trip ${clashing.reference} you have already taken.`,
      };
    }

    const searching = await this.bookings.beginSearching(bookingId, 'WAITING_DRIVER');
    if (searching === null) {
      // Somebody else moved it between the read and here — the ordinary race, not a fault.
      return {
        claimed: false,
        reason: 'lost the race to begin searching',
        message: 'Another driver has already taken this trip.',
      };
    }

    const claim = await this.bookings.claimForDriver(bookingId, driverId);

    if (!claim.claimed) {
      /*
       * THE BOOKING IS LEFT IN `SEARCHING` DELIBERATELY, and this is the one branch worth being
       * careful about. Losing the claim means somebody else is mid-assignment on this booking, so
       * putting it back to `WAITING_DRIVER` would fight them. If instead the claim failed for a
       * reason nobody is resolving, the booking is now in `SEARCHING` with its dispatch job still
       * pending at T−90, which re-reads it and carries on — the same recovery every abandoned
       * search already relies on.
       */
      logger.warn(
        { bookingId, driverId, reason: claim.reason },
        'scheduled board accept lost the claim after beginning the search',
      );

      return {
        claimed: false,
        reason: claim.reason ?? 'claim lost',
        message: 'Another driver has already taken this trip.',
      };
    }

    /*
     * Filed where every other assignment is, so a later ring excludes this driver and so ops sees
     * one kind of row rather than two. `FINAL` because it is the last word on the booking.
     */
    try {
      await this.offers.recordManualAssignment(bookingId, driverId);
    } catch (error) {
      logger.warn({ err: error, bookingId }, 'could not record the scheduled board assignment');
    }

    try {
      await this.notifications.sendBookingUpdate(
        { role: 'CUSTOMER', id: claim.booking.customerId },
        {
          bookingId,
          reference: claim.booking.reference,
          status: 'ASSIGNED',
          message: 'Good news — a driver has taken your trip.',
        },
      );
    } catch (error) {
      logger.warn({ err: error, bookingId }, 'could not tell the customer their trip was taken');
    }

    return { claimed: true, booking: claim.booking };
  }
}
