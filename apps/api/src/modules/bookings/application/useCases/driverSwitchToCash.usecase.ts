import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { ExtensionRepositoryPort } from '../../domain/extensionRepository.port.js';
import { totalExtension } from '../../domain/bookingExtension.entity.js';
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

export interface CollectExtrasInCashInput {
  bookingId: string;
  driverId: string;
}

/**
 * The same fallback, for the one thing `DriverSwitchToCashUseCase` above cannot rescue.
 *
 * WHY IT EXISTS. `CompleteTripUseCase` refuses to end a UPI trip whose extra day has not been paid
 * for — without that refusal the extra silently becomes a receivable nobody chases, which is the
 * bug this whole path was built to close. But the usual way through a payment gate refuses a
 * booking whose fare has ALREADY been paid online, and that is precisely the trip this happens
 * on: the customer paid at nine in the morning, bought a day at nine at night, and their phone is
 * now dead. Without this the driver is stuck on a gate with no door.
 *
 * IT DOES NOT TOUCH `paymentMode`. The fare really was paid online and switching the booking to
 * cash would make `ConfirmLatePaymentUseCase` refund it. Only the extension moves, and only into
 * `cashExtensionPaise`, so the ledger can book the driver as holding the company's money.
 *
 * THE DRIVER'S WORD, like `cashCollectedPaise` on completion. There is no way to verify cash
 * changing hands at a kerb, and a system that pretends otherwise just makes the driver lie in a
 * different field. Recording the real movement and letting reconciliation find a gap is the same
 * choice `CompleteTripUseCase` documents.
 */
export class CollectExtrasInCashUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly extensions: ExtensionRepositoryPort,
  ) {}

  async execute(input: CollectExtrasInCashInput): Promise<Booking> {
    const booking = await loadForDriver(this.repo, input.bookingId, input.driverId);

    if (booking.status !== 'STARTED') {
      throw AppError.conflict('You can only do this while the trip is under way.');
    }

    const extras = totalExtension(await this.extensions.listForBooking(booking.id));
    const owedPaise = extras.amountPaise - booking.paidExtensionPaise;
    if (owedPaise <= 0) {
      throw AppError.conflict('There is nothing outstanding on the extra day.');
    }

    const updated = await this.repo.addCashExtensionPaise(booking.id, owedPaise);

    logger.info(
      { bookingId: booking.id, reference: booking.reference, driverId: input.driverId, owedPaise },
      'driver collected the day extension in cash',
    );

    return updated ?? booking;
  }
}
