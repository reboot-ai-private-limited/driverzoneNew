import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import { loadForDriver } from '../bookingAccess.js';

export interface DriverSwitchToCashInput {
  bookingId: string;
  driverId: string;
}

/**
 * The fallback for a customer who cannot pay online after all — a dead phone, no signal, a
 * failed card — and hands the driver cash instead. Without this the driver is stuck on
 * `CompleteTripUseCase`'s payment gate with no way through: the customer's app is the only thing
 * that can otherwise change `paymentMode`, and by definition it is unavailable here.
 *
 * SAME DEBT GUARD AS `SelectPaymentMethodUseCase`'s cash branch — a customer carrying wallet debt
 * cannot pay it off in cash, driver-initiated or not.
 *
 * DOES NOT CANCEL ANY OPEN RAZORPAY ORDER — Razorpay has no such call, and the order simply goes
 * unpaid. If it is paid anyway after this runs (the customer's connectivity returns and they
 * complete a checkout they had already started), `ConfirmLatePaymentUseCase` notices the booking
 * is no longer `UPI` and refunds the stray capture instead of collecting it twice.
 */
export class DriverSwitchToCashUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(input: DriverSwitchToCashInput): Promise<Booking> {
    const booking = await loadForDriver(this.repo, input.bookingId, input.driverId);

    if (booking.status !== 'STARTED') {
      throw AppError.conflict('You can only do this while the trip is under way.');
    }
    if (booking.paymentStatus === 'PAID') {
      throw AppError.conflict('This trip has already been paid for online.');
    }
    if (booking.walletDebtPaise > 0) {
      throw AppError.badRequest(
        'This customer has an unpaid cancellation fee that can only be cleared online. Ask them to pay by UPI.',
        { outstanding_dues_paise: booking.walletDebtPaise },
      );
    }

    const updated = await this.repo.setPaymentMode(booking.id, 'CASH', 'CASH');

    logger.info(
      { bookingId: booking.id, reference: booking.reference, driverId: input.driverId },
      'driver switched booking to cash payment',
    );

    try {
      await this.notifications.sendBookingUpdate(
        { role: 'CUSTOMER', id: booking.customerId },
        {
          bookingId: booking.id,
          reference: booking.reference,
          status: booking.status,
          message: 'Your driver has marked this trip as paid in cash.',
        },
      );
    } catch (error) {
      logger.warn(
        { err: error, bookingId: booking.id },
        'could not notify the customer of a driver-initiated switch to cash',
      );
    }

    return updated ?? { ...booking, paymentMode: 'CASH', paymentStatus: 'CASH' };
  }
}
