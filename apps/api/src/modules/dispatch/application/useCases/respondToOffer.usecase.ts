import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { Booking, BookingDispatchContract } from '../../../bookings/bookings.public.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { OfferRepositoryPort } from '../../domain/ports.js';

export type AcceptResult =
  | { claimed: true; booking: Booking }
  /**
   * Another driver got there first. THIS IS NOT A FAILURE ON THE DRIVER'S PART and must never
   * count against their acceptance rate — the offer is marked `SUPERSEDED`, which is excluded
   * from the rate by design.
   */
  | { claimed: false; reason: 'ALREADY_ASSIGNED'; message: string }
  | { claimed: false; reason: 'OFFER_EXPIRED'; message: string };

/**
 * A driver accepts an offer.
 *
 * TWO COMPARE-AND-SWAPS, in this order, and the order matters. The offer is claimed first — that
 * is what makes exactly one of five simultaneous taps proceed to the booking — and only the
 * winner then attempts the booking claim. Doing it the other way round would let five drivers all
 * race on the booking with their offers still live, and the losers would have no offer state
 * recording that they tried.
 */
export class AcceptOfferUseCase {
  constructor(
    private readonly offers: OfferRepositoryPort,
    private readonly bookings: BookingDispatchContract,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(offerId: string, driverId: string): Promise<AcceptResult> {
    const offer = await this.offers.findById(offerId);
    if (offer === null || offer.driverId !== driverId) {
      throw new AppError({
        statusCode: 404,
        code: 'OFFER_NOT_FOUND',
        message: 'That offer is no longer available.',
        isExpected: true,
      });
    }

    const now = new Date();

    // The offer is still SENT and unexpired, or this driver has already lost.
    const claimedOffer = await this.offers.respond(offerId, 'ACCEPTED', now);
    if (claimedOffer === null) {
      const current = await this.offers.findById(offerId);
      const reason = current?.status === 'SUPERSEDED' ? 'ALREADY_ASSIGNED' : 'OFFER_EXPIRED';

      return reason === 'ALREADY_ASSIGNED'
        ? {
            claimed: false,
            reason,
            message: 'This trip was just taken by another driver.',
          }
        : {
            claimed: false,
            reason,
            message: 'That offer expired before it could be accepted.',
          };
    }

    // The booking claim. `driverId: null` AND `status: SEARCHING` are both in its filter.
    const claim = await this.bookings.claimForDriver(offer.bookingId, driverId);

    if (!claim.claimed) {
      /*
       * The offer was won and the booking was not — the booking moved between the two swaps.
       * Rolling the offer back to SUPERSEDED is what keeps this off the driver's acceptance
       * rate: they accepted in good faith and lost to something outside their control.
       *
       * `releaseAccepted`, not `respond`: the offer is ACCEPTED by now, and `respond` only swaps
       * out of SENT, so it would quietly do nothing and leave a phantom accepted offer behind.
       */
      await this.offers.releaseAccepted(offerId);

      logger.info(
        { offerId, driverId, bookingId: offer.bookingId, reason: claim.reason },
        'offer accepted but the booking could not be claimed',
      );

      return {
        claimed: false,
        reason: 'ALREADY_ASSIGNED',
        message:
          claim.reason === 'ALREADY_ASSIGNED'
            ? 'This trip was just taken by another driver.'
            : 'This trip is no longer available.',
      };
    }

    /*
     * Withdraw everyone else's ringing offer immediately. A driver staring at an offer that has
     * already been taken is the single most irritating thing this system can do to them — and the
     * `offer.cancelled` push is what closes that screen.
     */
    const superseded = await this.offers.supersedeOthers(offer.bookingId, offerId);
    await Promise.all(
      superseded.map((other) =>
        this.notifications
          .cancelOffer(other.driverId, other.id, 'TAKEN_BY_ANOTHER_DRIVER')
          .catch((error: unknown) => {
            logger.warn({ err: error, offerId: other.id }, 'could not withdraw a superseded offer');
          }),
      ),
    );

    await this.notifications.sendBookingUpdate(
      { role: 'CUSTOMER', id: claim.booking.customerId },
      {
        bookingId: claim.booking.id,
        reference: claim.booking.reference,
        status: 'ASSIGNED',
        message: 'We have found you a driver.',
      },
    );

    return { claimed: true, booking: claim.booking };
  }
}

/**
 * A driver declines.
 *
 * Counted against their acceptance rate, unlike a loss — declining is a choice. It does not
 * advance the wave: the other drivers rung in this wave still have their TTL, and cutting it
 * short because one person said no would waste the others' chance to accept.
 */
export class DeclineOfferUseCase {
  constructor(private readonly offers: OfferRepositoryPort) {}

  async execute(offerId: string, driverId: string): Promise<void> {
    const offer = await this.offers.findById(offerId);
    if (offer === null || offer.driverId !== driverId) {
      throw new AppError({
        statusCode: 404,
        code: 'OFFER_NOT_FOUND',
        message: 'That offer is no longer available.',
        isExpected: true,
      });
    }

    await this.offers.respond(offerId, 'DECLINED', new Date());
  }
}
