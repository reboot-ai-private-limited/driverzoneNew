import { logger } from '../../../../shared/logging/logger.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';

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
 * The other half of the webhook: a payment that failed leaves the booking unbookable.
 *
 * Expired rather than cancelled, and the distinction matters on a receipt — nobody cancelled
 * anything, the money simply never arrived. No cancellation fee applies, because there was never
 * a confirmed booking to cancel.
 */
export class FailBookingPaymentUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(bookingId: string, reason: string): Promise<Booking | null> {
    const booking = await this.repo.findById(bookingId);
    if (booking === null || booking.status !== 'PENDING_PAYMENT') return booking;

    const expired = await this.repo.transition({
      bookingId,
      from: 'PENDING_PAYMENT',
      to: 'EXPIRED',
      actor: { type: 'SYSTEM', id: null },
      metadata: { via: 'payment.failed', reason },
    });

    if (expired !== null) {
      await this.notifications.sendBookingUpdate(
        { role: 'CUSTOMER', id: booking.customerId },
        {
          bookingId: booking.id,
          reference: booking.reference,
          status: 'EXPIRED',
          message: 'Your payment did not go through, so the booking was not made.',
        },
      );
    }

    return expired ?? this.repo.findById(bookingId);
  }
}
