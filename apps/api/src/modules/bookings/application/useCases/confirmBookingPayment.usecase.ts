import { logger } from '../../../../shared/logging/logger.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { ChargeRepositoryPort } from '../../domain/chargeRepository.port.js';

/** Enqueues the dispatch job. Injected so `bookings` need not depend on `dispatch`, which is above it. */
export type DispatchScheduler = (booking: Booking) => Promise<void>;

/**
 * Moves a booking to CONFIRMED once its payment has been captured.
 *
 * Called from the payment webhook, never from a client. THE CUSTOMER'S APP MUST NOT BE ABLE TO
 * CONFIRM ITS OWN BOOKING — that is the entire reason payment precedes confirmation rather than
 * following it, and the only thing making the gateway's word authoritative is the signature the
 * webhook route checks before this runs.
 *
 * IDEMPOTENT. Providers redeliver, so a booking already past PENDING_PAYMENT is a successful
 * no-op rather than an error.
 */
export class ConfirmBookingPaymentUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly notifications: NotificationsContract,
    private readonly scheduleDispatch: DispatchScheduler,
    private readonly charges: ChargeRepositoryPort,
  ) {}

  async execute(bookingId: string): Promise<Booking | null> {
    const booking = await this.repo.findById(bookingId);
    if (booking === null) return null;

    if (booking.status !== 'PENDING_PAYMENT') {
      logger.info(
        { bookingId, status: booking.status },
        'payment captured for a booking that is no longer pending — nothing to do',
      );
      return booking;
    }

    const confirmed = await this.repo.transition({
      bookingId,
      from: 'PENDING_PAYMENT',
      to: 'CONFIRMED',
      actor: { type: 'SYSTEM', id: null },
      metadata: { via: 'payment.captured' },
    });

    // Lost the swap: something else moved it first. Whatever that was, it was not this.
    if (confirmed === null) return this.repo.findById(bookingId);

    /*
     * The order that just captured included any unpaid dues, so they are collected now.
     *
     * Settled HERE rather than when the order was created, because this is when the money actually
     * arrived — clearing a debt at creation would wipe it for a customer who then abandoned
     * checkout, and they would have got the cancellation fee waived by not paying.
     */
    if (confirmed.paymentId !== null) {
      try {
        await this.charges.settleDues(confirmed.customerId, confirmed.paymentId);
      } catch (error) {
        logger.error(
          { err: error, bookingId },
          'could not settle outstanding dues against the captured payment',
        );
      }
    }

    /*
     * SIDE EFFECTS AFTER THE COMMIT, never inside it. A push that fails must not roll back a
     * confirmation the customer's money has already paid for — so these are attempted, logged and
     * allowed to fail, and the sweeper is what catches a dispatch job that never got enqueued.
     */
    try {
      await this.scheduleDispatch(confirmed);
    } catch (error) {
      logger.error(
        { err: error, bookingId, dispatchAt: confirmed.dispatchAt },
        'could not enqueue dispatch — the sweeper will pick this up',
      );
    }

    await this.notifications.sendBookingUpdate(
      { role: 'CUSTOMER', id: confirmed.customerId },
      {
        bookingId: confirmed.id,
        reference: confirmed.reference,
        status: 'CONFIRMED',
        message: confirmed.isScheduled
          ? 'Your booking is confirmed. We will find you a driver closer to the time.'
          : 'Your booking is confirmed. We are finding you a driver.',
      },
    );

    return confirmed;
  }
}

/**
 * The other half of the webhook: a payment that failed.
 *
 * IT DOES NOT TOUCH THE BOOKING, and that is the whole point.
 *
 * Razorpay documents that a UPI retry can deliver `payment.failed` and then `payment.captured` for
 * ONE transaction. Expiring the booking on the failure looks tidy and is the expensive mistake:
 * `EXPIRED` is terminal, so the capture that follows has nowhere to go — the customer's money has
 * moved and there is no trip. That is a refund, a support call, and a person who does not use the
 * app again.
 *
 * So the failure is recorded on the payment (already done by the time this runs) and told to the
 * customer as "try again", while the booking waits at `PENDING_PAYMENT`. What eventually clears an
 * abandoned one is the sweeper's 30-minute window, which comfortably outlives Razorpay's retries.
 */
export class FailBookingPaymentUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(bookingId: string, reason: string): Promise<Booking | null> {
    const booking = await this.repo.findById(bookingId);
    if (booking === null || booking.status !== 'PENDING_PAYMENT') return booking;

    logger.info(
      { bookingId, reference: booking.reference, reason },
      'payment failed — booking left pending in case a retry captures',
    );

    await this.notifications.sendBookingUpdate(
      { role: 'CUSTOMER', id: booking.customerId },
      {
        bookingId: booking.id,
        reference: booking.reference,
        // Still PENDING_PAYMENT: nothing about the booking changed, only the attempt to pay for it.
        status: 'PENDING_PAYMENT',
        message: 'Your payment did not go through. Please try again to confirm this booking.',
      },
    );

    return booking;
  }
}
