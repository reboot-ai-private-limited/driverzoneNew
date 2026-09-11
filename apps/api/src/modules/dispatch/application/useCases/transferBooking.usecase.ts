import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { Booking, BookingDispatchContract } from '../../../bookings/bookings.public.js';
import type { AssignableDriversContract } from '../../../identity/identity.public.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { OfferRepositoryPort } from '../../domain/ports.js';
import { requirementFromBooking, vehicleMismatchReason } from '../../domain/vehicleCompatibility.js';

/**
 * MANUAL ASSIGNMENT — ops hands one booking to one driver they chose
 * (docs/LLD/dispatch-and-assignment.md §Reassignment, §Manual assignment).
 *
 * IT LIVES IN `dispatch` BECAUSE IT WRITES `bookings.driverId`, and this is the only module
 * permitted to — a rule `.dependency-cruiser.cjs` enforces by tier and `bookings.public.ts`
 * enforces by shape. Putting an ops convenience in `bookings` would have quietly made that rule
 * untrue.
 *
 * RELEASE, THEN CLAIM — two existing moves rather than a third way to write a driver onto a
 * booking. `releaseDriver` returns the trip to `SEARCHING` with no driver, which is exactly the
 * state `claimForDriver`'s compare-and-swap demands, so the single guarantee behind invariant B-2
 * ("driverId goes from null to non-null exactly once") keeps having exactly one implementation.
 *
 * A LOST CLAIM IS NOT A LOST BOOKING. If a dispatch wave lands in the gap between the two, the
 * winner keeps the trip and this reports that ops's pick did not stick. The booking is assigned
 * either way, which is the outcome that actually matters.
 */
export class TransferBookingUseCase {
  constructor(
    private readonly bookings: BookingDispatchContract,
    private readonly drivers: AssignableDriversContract,
    private readonly offers: OfferRepositoryPort,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(input: {
    bookingId: string;
    toDriverId: string;
    reason: string;
    adminId: string;
  }): Promise<{ booking: Booking; releasedDriverId: string | null }> {
    const booking = await this.bookings.findById(input.bookingId);
    if (booking === null) throw AppError.notFound('That booking does not exist.');

    if (booking.driverId === input.toDriverId) {
      throw AppError.badRequest('That driver already has this booking.');
    }

    /*
     * CHECKED BEFORE THE RELEASE, not after. Releasing first and then discovering the target is
     * ineligible would leave the booking un-driven and back in the dispatch pool — ops would have
     * taken a trip off a working driver to achieve nothing.
     */
    await this.assertAssignable(input.toDriverId, booking);

    const releasedDriverId = booking.driverId;

    /*
     * NOTHING TO RELEASE ON A BOOKING NOBODY HAS. That is the other half of manual assignment
     * (docs/LLD/dispatch-and-assignment.md §Manual assignment): dispatch ran out of waves, the
     * booking is sitting in `SEARCHING`, and ops has found somebody by phone. It goes straight to
     * the claim — releasing a driver who does not exist would refuse, since `SEARCHING` is not a
     * reassignable status and never should be.
     */
    if (releasedDriverId !== null) {
      const released = await this.bookings.releaseDriver(
        input.bookingId,
        input.reason,
        input.adminId,
      );

      if (released === null) {
        /*
         * `releaseDriver` refuses anything outside `REASSIGNABLE_STATUSES`, and `STARTED` is the
         * one people will actually hit — so it is named rather than folded into a generic message.
         */
        throw AppError.conflict(
          booking.status === 'STARTED'
            ? 'This trip has already started. Transferring it now would be a cancellation and a new booking — cancel it instead.'
            : `A booking at ${booking.status} cannot be transferred.`,
        );
      }
    } else if (booking.status !== 'SEARCHING') {
      // No driver AND not searching: confirmed and not yet dispatched, cancelled, or finished.
      // None of those is a booking to hand somebody.
      throw AppError.conflict(`A booking at ${booking.status} cannot be assigned a driver.`);
    }

    const claim = await this.bookings.claimForDriver(input.bookingId, input.toDriverId, {
      type: 'ADMIN',
      id: input.adminId,
      reason: input.reason,
    });

    if (!claim.claimed) {
      logger.warn(
        { bookingId: input.bookingId, toDriverId: input.toDriverId, reason: claim.reason },
        'manual transfer released the booking but lost the claim — dispatch has it',
      );

      throw AppError.conflict(
        'The booking was released but another driver took it first. It is assigned again — reload to see who has it.',
      );
    }

    /*
     * THE OFFER ROW EXISTS SO THE ASSIGNMENT IS VISIBLE WHERE EVERY OTHER ONE IS, and so a later
     * wave's `driverIdsOffered` exclusion covers this driver too — without it, a manually assigned
     * driver who is released again could be rung for the same booking.
     *
     * It is filed under `MANUAL_ASSIGNMENT_WAVE` — see `offer.entity.ts` on why that is negative
     * rather than 0 (the favourite wave) or 1 (which would make the ranker look responsible for a
     * driver a person chose).
     */
    try {
      await this.offers.recordManualAssignment(input.bookingId, input.toDriverId);
    } catch (error) {
      // The driver HAS the trip — that already committed. A missing audit row is worth a log.
      logger.warn(
        { err: error, bookingId: input.bookingId },
        'could not record the manual assignment offer row',
      );
    }

    await this.notify(claim.booking, releasedDriverId, input.toDriverId, input.reason);

    return { booking: claim.booking, releasedDriverId };
  }

  /** Verified, unblocked, not already driving somebody else, and able to drive this trip. */
  private async assertAssignable(driverId: string, booking: Booking): Promise<void> {
    /*
     * BY ID, not through the picker's free-text `search` — a driver's own id is never a substring
     * of their name or phone, so asking `assignableDrivers(driverId, 1)` (this line, until it was
     * caught testing the feature end to end rather than against a fake) always came back empty and
     * refused every real transfer. `null` here means unverified, blocked, or not a driver at all —
     * and the caller learns none of which, deliberately.
     */
    const match = await this.drivers.assignableDriverById(driverId);

    if (match === null) {
      throw AppError.notFound('That driver cannot be assigned work.');
    }

    if (await this.bookings.hasActiveBooking(driverId)) {
      throw AppError.conflict(
        `${match.fullName ?? 'That driver'} is already on a trip. Finish or cancel it before assigning another.`,
      );
    }

    /*
     * THE SAME COMPETENCY GATE THE POOL APPLIES DURING A WAVE. Manual assignment is the one path
     * that bypasses `MongoDriverPool`, and until now that meant bypassing this check along with
     * it — an admin could hand an SUV booking to a hatchback driver with no warning at all.
     */
    const mismatch = vehicleMismatchReason(match, requirementFromBooking(booking));
    if (mismatch !== null) {
      const who = match.fullName ?? 'That driver';
      throw AppError.conflict(
        mismatch === 'HILL'
          ? `${who} is not verified for hill driving, which this trip requires.`
          : `${who}'s vehicle does not match what this trip requires.`,
      );
    }
  }

  private async notify(
    booking: Booking,
    releasedDriverId: string | null,
    toDriverId: string,
    reason: string,
  ): Promise<void> {
    /*
     * Tolerant of failure, one at a time. The transfer has committed; a stale device token must
     * not turn a completed reassignment into an error the admin sees and retries.
     */
    const sends: Array<Promise<unknown>> = [];

    if (releasedDriverId !== null) {
      sends.push(
        this.notifications.sendBookingUpdate(
          { role: 'DRIVER', id: releasedDriverId },
          {
            bookingId: booking.id,
            reference: booking.reference,
            status: 'CANCELLED_BY_ADMIN',
            // Says it is not held against them, because a driver has no way to tell an ops
            // reassignment from their own cancellation — and that one carries a penalty.
            message: `The office has moved this trip to another driver: ${reason}. It does not count against you.`,
          },
        ),
      );
    }

    sends.push(
      this.notifications.sendBookingUpdate(
        { role: 'DRIVER', id: toDriverId },
        {
          bookingId: booking.id,
          reference: booking.reference,
          status: 'ASSIGNED',
          message: 'The office has assigned you this trip.',
        },
      ),
      this.notifications.sendBookingUpdate(
        { role: 'CUSTOMER', id: booking.customerId },
        {
          bookingId: booking.id,
          reference: booking.reference,
          status: 'ASSIGNED',
          message: 'Your driver has changed. Your trip is still on.',
        },
      ),
    );

    const results = await Promise.allSettled(sends);
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.warn(
          { err: result.reason, bookingId: booking.id },
          'could not deliver a transfer notification',
        );
      }
    }
  }
}
