import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { PaymentMode } from '@driverzone/contracts';
import type { PaymentsContract } from '../../../payments/payments.public.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { ExtensionRepositoryPort } from '../../domain/extensionRepository.port.js';
import { totalExtension } from '../../domain/bookingExtension.entity.js';

export interface SelectPaymentMethodInput {
  bookingId: string;
  customerId: string;
  paymentMode: PaymentMode;
  idempotencyKey: string;
}

export interface SelectedPaymentMethod {
  booking: Booking;
  clientToken: string | null;
  publicKey: string | null;
  amountPaise: number | null;
}

/**
 * Lets the customer choose how to pay (CASH or UPI) once the trip has STARTED.
 *
 * Enforces:
 *   - The ride must be actively underway (status STARTED).
 *   - The customer must own the booking.
 *   - A PREPAID booking (set by an admin) cannot be changed — the fare is already paid.
 *   - Retries of the same choice are idempotent.
 *
 * CASH IS ALWAYS ALLOWED (2026-10-13), including for a customer carrying an old cancellation fee:
 * the fee is already on this booking (`walletDebtPaise`), the driver collects it with the fare,
 * and `CompleteTripUseCase` marks it collected on the wallet. It used to be refused here.
 *
 * A UPI order raised here also includes any day extension already accepted by this point — see
 * `paidExtensionPaise` on `Booking`.
 */
export class SelectPaymentMethodUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly payments: PaymentsContract,
    private readonly extensions: ExtensionRepositoryPort,
  ) {}

  async execute(input: SelectPaymentMethodInput): Promise<SelectedPaymentMethod> {
    const booking = await this.repo.findById(input.bookingId);

    if (booking === null || booking.customerId !== input.customerId) {
      throw AppError.notFound('That booking does not exist.');
    }

    if (booking.status !== 'STARTED') {
      throw AppError.badRequest('You can choose how to pay once your driver has started the trip.');
    }

    if (booking.paymentMode === 'PREPAID') {
      throw AppError.conflict('This trip is already paid for. There is nothing to choose.');
    }

    // Idempotent retry: same mode already selected
    if (booking.paymentMode === input.paymentMode) {
      if (input.paymentMode === 'CASH') {
        return { booking, clientToken: null, publicKey: null, amountPaise: null };
      }

      // UPI retry: find the existing BOOKING charge if any. Already captured means there is
      // nothing left to check out — a `clientToken` here would invite reopening checkout on an
      // order that is done.
      if (booking.paymentStatus === 'PAID') {
        return { booking, clientToken: null, publicKey: null, amountPaise: null };
      }

      /*
       * REOPENS THE SAME ORDER — read off the payment row, not recomputed. Extensions can be
       * accepted between the first selection and a retry; recomputing here would ask Razorpay to
       * check out an amount that does not match the order id already handed to the customer.
       */
      const existingPayments = await this.payments.listForBooking(booking.id);
      const bookingPayment = existingPayments.find((p) => p.kind === 'BOOKING');
      const amountPaise =
        bookingPayment?.amountPaise ??
        booking.fareSnapshot.fare.totalPaise - booking.walletCreditPaise + booking.walletDebtPaise;

      return {
        booking,
        clientToken: bookingPayment?.gatewayRef ?? null,
        publicKey: this.payments.publicKey,
        amountPaise,
      };
    }

    if (booking.paymentStatus === 'PAID') {
      throw AppError.badRequest('This trip has already been paid for online.');
    }

    if (input.paymentMode === 'CASH') {
      const updated = await this.repo.setPaymentMode(booking.id, 'CASH', 'CASH');
      logger.info(
        { bookingId: booking.id, reference: booking.reference },
        'customer selected cash payment method',
      );

      return {
        booking: updated ?? { ...booking, paymentMode: 'CASH', paymentStatus: 'CASH' },
        clientToken: null,
        publicKey: null,
        amountPaise: null,
      };
    }

    // ── UPI: create charge and attach to booking ────────────────────────────────────────────
    /*
     * ANY EXTENSION ALREADY ACCEPTED BY NOW rides along in this one order, rather than waiting
     * for the completion settlement — see `extendBooking.usecase.ts`'s own doc comment for why an
     * extension accepted AFTER this point still settles at completion instead of a second charge.
     * `paidExtensionPaise` records exactly how much of it is here, so `CompleteTripUseCase` bills
     * only whatever is left.
     */
    const acceptedExtras = totalExtension(await this.extensions.listForBooking(booking.id));
    const amountPaise =
      booking.fareSnapshot.fare.totalPaise -
      booking.walletCreditPaise +
      booking.walletDebtPaise +
      acceptedExtras.amountPaise;

    const { payment, clientToken, publicKey } = await this.payments.charge({
      bookingId: booking.id,
      customerId: input.customerId,
      kind: 'BOOKING',
      amountPaise,
      reference: booking.reference,
      idempotencyKey: input.idempotencyKey,
    });

    const updated = await this.repo.setPaymentMode(booking.id, 'UPI', 'AWAITING_PAYMENT');
    await this.repo.attachPayment(booking.id, payment.id);
    if (acceptedExtras.amountPaise > 0) {
      await this.repo.setPaidExtensionPaise(booking.id, acceptedExtras.amountPaise);
    }

    logger.info(
      {
        bookingId: booking.id,
        reference: booking.reference,
        paymentId: payment.id,
        amountPaise,
      },
      'customer selected UPI payment method; payment order created',
    );

    return {
      booking: updated
        ? { ...updated, paymentId: payment.id, paidExtensionPaise: acceptedExtras.amountPaise }
        : {
            ...booking,
            paymentMode: 'UPI',
            paymentStatus: 'AWAITING_PAYMENT',
            paymentId: payment.id,
            paidExtensionPaise: acceptedExtras.amountPaise,
          },
      clientToken,
      publicKey,
      amountPaise,
    };
  }
}
