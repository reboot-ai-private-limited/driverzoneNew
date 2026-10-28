import { logger } from '../../../../shared/logging/logger.js';
import { isCaptured, type PaymentsContract } from '../../../payments/payments.public.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';

/**
 * WHAT A CAPTURED PAYMENT DOES TO ITS BOOKING.
 *
 * One use case for every messenger: the webhook's callback, and the driver's QR poll when it is the
 * one to learn of a capture. Both hang off the same compare-and-swap on the payment row, so for any
 * one capture exactly one of them calls this — and the money is credited once however the news
 * arrived.
 */
export class ApplyCapturedPaymentUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly payments: PaymentsContract,
    /** A first payment confirming a booking that was waiting on it. */
    private readonly confirm: { execute(bookingId: string): Promise<unknown> },
    /** A payment landing on a trip already under way — the customer or driver paying at the end. */
    private readonly confirmLate: { execute(bookingId: string): Promise<unknown> },
  ) {}

  async execute(bookingId: string, paymentId: string): Promise<void> {
    const payment = await this.payments.findById(paymentId);

    /*
     * A DAY EXTENSION being paid for is not the trip. It has its own order (`payExtras.usecase.ts`)
     * because the booking's own was raised, and usually captured, before the extra day existed.
     * Nothing about the booking's payment status changes — the fare was already settled — so this
     * credits the extension and stops.
     */
    if (payment?.kind === 'EXTENSION') {
      await this.repo.addPaidExtensionPaise(bookingId, payment.amountPaise);
      return;
    }

    if (payment?.kind === 'BOOKING') {
      /*
       * A SECOND ONLINE PAYMENT ON A TRIP THAT IS ALREADY PAID FOR — the customer's own checkout
       * and the driver's QR can both be live, and a customer can pay both. The later capture is
       * refunded in full; the trip keeps the first. Without this the customer is simply charged
       * twice, and nothing downstream would ever notice: the booking is PAID either way.
       *
       * "Earlier" is by when each was captured. Two arriving in the same instant could each see the
       * other as first and both be refunded — the customer ends up whole and the driver takes cash,
       * which is the safe way for the rare tie to fall.
       */
      const earlier = (await this.payments.listForBooking(bookingId)).filter(
        (p) =>
          p.id !== payment.id &&
          p.kind === 'BOOKING' &&
          isCaptured(p.status) &&
          p.updatedAt.getTime() <= payment.updatedAt.getTime(),
      );
      if (earlier.length > 0) {
        await this.payments.refund({ paymentId: payment.id, idempotencyKey: `dup-refund-${payment.id}` });
        logger.warn(
          { bookingId, paymentId: payment.id, keptPaymentId: earlier[0]?.id },
          'a second online payment landed on a trip already paid — refunded it',
        );
        return;
      }

      /*
       * A QR COLLECTED THE EXTRA DAY WITH THE FARE. Credit that part now, so the trip does not ask
       * the customer for it again — the same field an extras order credits. The waiting charge it
       * also covered needs no field: `completeTrip` reads it off this payment.
       */
      if (payment.channel === 'QR') {
        const extensionPaise = payment.metadata['extensionPaise'] ?? 0;
        if (extensionPaise > 0) await this.repo.addPaidExtensionPaise(bookingId, extensionPaise);
      }
    }

    const booking = await this.repo.findById(bookingId);
    if (booking?.status === 'PENDING_PAYMENT') {
      await this.confirm.execute(bookingId);
    } else {
      await this.confirmLate.execute(bookingId);
    }
  }
}
