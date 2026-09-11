import { logger } from '../../../../shared/logging/logger.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { WalletPublicContract } from '../../../wallet/wallet.public.js';
import { isCaptured, type PaymentsContract } from '../../../payments/payments.public.js';

/**
 * Handles payment.captured for a booking that was already CONFIRMED/STARTED when the payment was made.
 *
 * Updates the booking's payment status to PAID, collects any carried-over debt into the wallet,
 * and notifies both customer and driver that the trip can now be completed.
 *
 * Also the landing spot for a capture that arrives after the booking has since switched to cash
 * (`DriverSwitchToCashUseCase`) — see `refundStrayCapture` below.
 */
export class ConfirmLatePaymentUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly notifications: NotificationsContract,
    private readonly wallet: WalletPublicContract,
    private readonly payments: PaymentsContract,
  ) {}

  async execute(bookingId: string): Promise<void> {
    const booking = await this.repo.findById(bookingId);
    if (booking === null) return;

    /*
     * THE BOOKING IS NO LONGER UPI — most often `DriverSwitchToCashUseCase` ran because the
     * customer's own checkout was stuck, and cash was collected in person. If that same order
     * captures anyway (a network reply that finally arrives, a UPI intent the customer had
     * already committed to before switching), the money must go back — the driver is already
     * holding cash for this trip, and leaving it captured would double-charge the customer.
     */
    if (booking.paymentMode !== 'UPI') {
      await this.refundStrayCapture(booking.id, booking.customerId, booking.reference, booking.status);
      return;
    }

    await this.repo.setPaymentStatus(booking.id, 'PAID');

    /*
     * Collect the debt now that real money has actually moved.
     * Uses ONCE_PER_BOOKING_WALLET_TYPES idempotency, so redelivered webhooks do not double-collect.
     */
    if (booking.walletDebtPaise > 0) {
      try {
        await this.wallet.append([
          {
            customerId: booking.customerId,
            bookingId: booking.id,
            entryType: 'DEBT_COLLECTED',
            amountPaise: booking.walletDebtPaise,
            note: `Collected with trip ${booking.reference}`,
          },
        ]);
      } catch (error) {
        logger.error(
          { err: error, bookingId: booking.id },
          'could not record debt collection for late payment',
        );
      }
    }

    try {
      await this.notifications.sendBookingUpdate(
        { role: 'CUSTOMER', id: booking.customerId },
        {
          bookingId: booking.id,
          reference: booking.reference,
          status: booking.status,
          message: 'Payment received. Your trip can now be completed.',
        },
      );
    } catch (error) {
      logger.error({ err: error, bookingId: booking.id }, 'could not notify customer of payment');
    }

    if (booking.driverId) {
      try {
        await this.notifications.sendBookingUpdate(
          { role: 'DRIVER', id: booking.driverId },
          {
            bookingId: booking.id,
            reference: booking.reference,
            status: booking.status,
            message: "The customer's payment has cleared — you can end the trip now.",
          },
        );
      } catch (error) {
        logger.error({ err: error, bookingId: booking.id }, 'could not notify driver of payment');
      }
    }

    logger.info(
      { bookingId: booking.id, reference: booking.reference },
      'late online payment confirmed; booking marked as PAID',
    );
  }

  private async refundStrayCapture(
    bookingId: string,
    customerId: string,
    reference: string,
    status: Booking['status'],
  ): Promise<void> {
    const payments = await this.payments.listForBooking(bookingId);
    const bookingPayment = payments.find((p) => p.kind === 'BOOKING' && isCaptured(p.status));
    if (bookingPayment === undefined) return;

    try {
      await this.payments.refund({
        paymentId: bookingPayment.id,
        idempotencyKey: `stray-refund-${bookingId}`,
      });
      logger.warn(
        { bookingId, paymentId: bookingPayment.id },
        'refunded a payment captured after the booking had already switched to cash',
      );
    } catch (error) {
      logger.error(
        { err: error, bookingId, paymentId: bookingPayment.id },
        'could not refund a stray capture on a booking already switched to cash',
      );
      return;
    }

    try {
      await this.notifications.sendBookingUpdate(
        { role: 'CUSTOMER', id: customerId },
        {
          bookingId,
          reference,
          status,
          message: 'Your online payment was refunded — cash was already collected for this trip.',
        },
      );
    } catch (error) {
      logger.error({ err: error, bookingId }, 'could not notify customer of a stray-capture refund');
    }
  }
}
