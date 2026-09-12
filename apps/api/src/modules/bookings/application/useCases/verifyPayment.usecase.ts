import { AppError } from '../../../../shared/errors/AppError.js';
import type { PaymentsContract } from '../../../payments/payments.public.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import { loadForCustomer } from '../bookingAccess.js';
import type { ConfirmLatePaymentUseCase } from './confirmLatePayment.usecase.js';

export interface VerifyPaymentInput {
  bookingId: string;
  customerId: string;
  providerPaymentId: string;
  signature: string;
}

/**
 * Lets the customer app confirm its own checkout instantly, instead of waiting on the webhook.
 *
 * REUSES `ConfirmLatePaymentUseCase` RATHER THAN DUPLICATING IT — the wallet-debt collection and
 * the customer/driver notifications are exactly the same whichever messenger reports the capture
 * first (this endpoint, or the webhook `bookings.container.ts` also wires to it). Whichever one
 * gets there first does the work; `payments.verifyAndCapture`'s compare-and-swap makes the other
 * a safe no-op.
 */
export class VerifyPaymentUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly payments: PaymentsContract,
    private readonly confirmLate: ConfirmLatePaymentUseCase,
  ) {}

  async execute(input: VerifyPaymentInput): Promise<Booking> {
    const booking = await loadForCustomer(this.repo, input.bookingId, input.customerId);

    // Idempotent: the webhook, or an earlier call to this same endpoint, already settled it.
    if (booking.paymentStatus === 'PAID') return booking;

    if (booking.paymentMode !== 'UPI' || booking.paymentId === null) {
      throw AppError.badRequest('There is no online payment on this trip to verify.');
    }

    const { captured } = await this.payments.verifyAndCapture({
      paymentId: booking.paymentId,
      providerPaymentId: input.providerPaymentId,
      signature: input.signature,
    });

    if (!captured) {
      throw AppError.badRequest(
        'Payment could not be verified yet. If money was deducted, it will confirm shortly.',
      );
    }

    await this.confirmLate.execute(booking.id);

    const refreshed = await this.repo.findById(booking.id);
    return refreshed ?? booking;
  }
}

export interface VerifyExtrasPaymentInput extends VerifyPaymentInput {
  /** The payment `POST .../extras/pay` returned. */
  paymentId: string;
}

/**
 * The same accelerant, for the order that collects a day extension.
 *
 * A SEPARATE USE CASE RATHER THAN A FLAG ON THE ONE ABOVE, because almost nothing is shared. That
 * one confirms THE booking — it reads `booking.paymentId`, flips `paymentStatus` to PAID, collects
 * wallet debt and tells the driver the trip can end. None of that applies here: an extras order is
 * not the booking's payment, the booking was already PAID before it existed, and the only thing
 * its capture changes is how much of the extension has been collected.
 *
 * THE PAYMENT ID IS CHECKED AGAINST THE BOOKING, not taken on trust. It arrives from the app, and
 * an id belonging to somebody else's trip must not be able to credit this one.
 *
 * CREDITS ON `justCaptured` ALONE. The webhook is coming for the same capture and credits it
 * there; crediting on `captured` would count every extension twice.
 */
export class VerifyExtrasPaymentUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly payments: PaymentsContract,
  ) {}

  async execute(input: VerifyExtrasPaymentInput): Promise<Booking> {
    const booking = await loadForCustomer(this.repo, input.bookingId, input.customerId);

    const payment = await this.payments.findById(input.paymentId);
    if (payment === null || payment.bookingId !== booking.id || payment.kind !== 'EXTENSION') {
      throw AppError.badRequest('That payment does not belong to this trip.');
    }

    const { captured, justCaptured } = await this.payments.verifyAndCapture({
      paymentId: payment.id,
      providerPaymentId: input.providerPaymentId,
      signature: input.signature,
    });

    if (!captured) {
      throw AppError.badRequest(
        'Payment could not be verified yet. If money was deducted, it will confirm shortly.',
      );
    }

    if (justCaptured) await this.repo.addPaidExtensionPaise(booking.id, payment.amountPaise);

    const refreshed = await this.repo.findById(booking.id);
    return refreshed ?? booking;
  }
}
