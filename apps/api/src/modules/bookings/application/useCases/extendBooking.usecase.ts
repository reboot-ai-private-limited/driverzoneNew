import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { SettingsReadContract } from '../../../settings/settings.public.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { BookingExtension } from '../../domain/bookingExtension.entity.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { ExtensionRepositoryPort } from '../../domain/extensionRepository.port.js';
import { loadForCustomer, loadForDriver } from '../bookingAccess.js';

/**
 * APPLICATION — buying one more day on a trip already under way.
 *
 * THE CUSTOMER ASKS AND THE DRIVER AGREES. An extension commits somebody else's next 24 hours, so
 * it is a request, not a purchase: nothing is charged, and nothing is promised to the customer,
 * until the driver has said yes. A driver with a booking of their own the next morning must be
 * able to say no without that being a failure.
 *
 * NOTHING IS COLLECTED HERE EITHER WAY. An accepted extension settles at completion, alongside the
 * waiting charge, through the machinery `completeTrip.usecase.ts` already has — one adjustment row
 * on the receipt, one gateway settlement on UPI, cash at the door otherwise. Charging mid-trip
 * would mean a second Razorpay call per extension and a refund path for a trip that then gets
 * cancelled.
 */

/** Why a booking cannot be extended. Each is a different sentence to the customer. */
export type ExtensionRefusal =
  | 'NOT_STARTED'
  | 'NOT_OUTSTATION'
  | 'NO_DAY_RATE'
  | 'NO_DRIVER'
  | 'ALREADY_PENDING';

const REFUSAL_MESSAGE: Record<ExtensionRefusal, string> = {
  NOT_STARTED: 'You can only add a day once your trip has started.',
  NOT_OUTSTATION: 'Only an outstation trip can be extended by a day.',
  /*
   * Says the honest thing rather than inventing a price. A booking made before the day rate was
   * frozen onto the fare has no agreed per-day figure, and guessing one from the total would
   * charge a customer a number nobody ever quoted them.
   */
  NO_DAY_RATE: 'This booking was made before day extensions were available. Please call support.',
  NO_DRIVER: 'There is no driver on this trip to ask.',
  ALREADY_PENDING: 'Your driver has not answered your last request yet.',
};

/** The sentence a customer is shown for a refusal. One wording, wherever it is reported. */
export function extensionRefusalMessage(refusal: ExtensionRefusal): string {
  return REFUSAL_MESSAGE[refusal];
}

/**
 * Everything that decides whether a booking can be extended, in one function.
 *
 * SHARED BY THE GUARD AND THE MAPPER, deliberately. `BookingDto.extension.can_extend` is this,
 * and so is the check the request endpoint itself runs — two copies of five conditions is how a
 * button comes to appear on a trip the server will refuse, and the customer finds out by tapping
 * it.
 */
export function extensionRefusal(
  booking: Booking,
  hasPending: boolean,
): ExtensionRefusal | null {
  if (booking.status !== 'STARTED') return 'NOT_STARTED';
  if (booking.serviceType !== 'OUTSTATION') return 'NOT_OUTSTATION';
  if (booking.driverId === null) return 'NO_DRIVER';

  const perDay = booking.fareSnapshot.fare.perDay;
  if (perDay === null || perDay === undefined) return 'NO_DAY_RATE';

  if (hasPending) return 'ALREADY_PENDING';
  return null;
}

export class RequestBookingExtensionUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly extensions: ExtensionRepositoryPort,
    private readonly settings: SettingsReadContract,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(input: {
    bookingId: string;
    customerId: string;
  }): Promise<BookingExtension> {
    const booking = await loadForCustomer(this.repo, input.bookingId, input.customerId);

    const pending = await this.extensions.findPending(booking.id);
    const refusal = extensionRefusal(booking, pending !== null);
    if (refusal !== null) throw AppError.conflict(REFUSAL_MESSAGE[refusal]);

    // Narrowed by `extensionRefusal` above; re-read here because TypeScript cannot see through it.
    const perDay = booking.fareSnapshot.fare.perDay;
    const driverId = booking.driverId;
    if (perDay === null || perDay === undefined || driverId === null) {
      throw AppError.conflict(REFUSAL_MESSAGE.NO_DAY_RATE);
    }

    const snapshot = await this.settings.snapshot();
    const ttlMinutes = snapshot['booking.extension_request_ttl_minutes'];

    const extension = await this.extensions.open({
      bookingId: booking.id,
      customerId: booking.customerId,
      driverId,
      /*
       * ONE DAY'S FARE, not one day's fare plus a share of the fixed lines. The pickup fee, the
       * surcharge and the insurance are properties of the TRIP and were charged once — the same
       * decision `computeOutstationFare` already takes when it multiplies only the band fare.
       * Tax is not added either: the booking's tax was computed on its own subtotal and this row
       * is settled as an adjustment, exactly like the waiting charge.
       */
      amountPaise: perDay.farePaise,
      driverAmountPaise: perDay.driverAmountPaise,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });

    if (extension === null) {
      // Lost the race against the partial unique index — somebody double-tapped. Not an error
      // worth a stack trace; the answer is the same as the guard above would have given.
      throw AppError.conflict(REFUSAL_MESSAGE.ALREADY_PENDING);
    }

    try {
      await this.notifications.sendBookingUpdate(
        { role: 'DRIVER', id: driverId },
        {
          bookingId: booking.id,
          reference: booking.reference,
          status: booking.status,
          message: 'Your customer has asked to keep you one more day. Open the trip to answer.',
        },
      );
    } catch (error) {
      // The request IS open and the driver can see it on the trip screen when they next look.
      logger.warn(
        { err: error, bookingId: booking.id },
        'could not notify the driver of an extension request',
      );
    }

    return extension;
  }
}

/**
 * The driver's answer.
 *
 * ONE USE CASE FOR BOTH, because accepting and declining differ only in the word swapped in and
 * the sentence sent back to the customer. Splitting them would duplicate the compare-and-swap and
 * the ownership check — the two parts that actually matter.
 */
export class RespondToExtensionUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly extensions: ExtensionRepositoryPort,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(input: {
    bookingId: string;
    driverId: string;
    accept: boolean;
  }): Promise<BookingExtension> {
    const booking = await loadForDriver(this.repo, input.bookingId, input.driverId);

    const pending = await this.extensions.findPending(booking.id);
    if (pending === null) {
      throw AppError.notFound('There is no extension request waiting on this trip.');
    }

    const answered = await this.extensions.respond(
      pending.id,
      input.accept ? 'ACCEPTED' : 'DECLINED',
      new Date(),
    );

    if (answered === null) {
      // The compare-and-swap did not apply: the sweep expired it in the meantime.
      throw AppError.conflict('That request has expired. Ask your customer to send it again.');
    }

    try {
      await this.notifications.sendBookingUpdate(
        { role: 'CUSTOMER', id: booking.customerId },
        {
          bookingId: booking.id,
          reference: booking.reference,
          status: booking.status,
          message: input.accept
            ? 'Your driver has agreed to the extra day. It will be added to your bill at the end of the trip.'
            : 'Your driver cannot stay an extra day. Nothing has been charged.',
        },
      );
    } catch (error) {
      logger.warn(
        { err: error, bookingId: booking.id },
        'could not notify the customer of an extension answer',
      );
    }

    return answered;
  }
}
