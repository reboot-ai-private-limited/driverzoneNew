import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { PaymentsContract } from '../../../payments/payments.public.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { ExtensionRepositoryPort } from '../../domain/extensionRepository.port.js';
import { totalExtension } from '../../domain/bookingExtension.entity.js';
import { loadForCustomer } from '../bookingAccess.js';

export interface PayTripExtrasInput {
  bookingId: string;
  customerId: string;
}

export interface TripExtrasOrder {
  paymentId: string;
  clientToken: string | null;
  publicKey: string | null;
  amountPaise: number;
}

/**
 * APPLICATION — collecting a day extension the booking's own order could not have covered.
 *
 * THE GAP THIS CLOSES. `SelectPaymentMethodUseCase` folds an already-accepted extension into the
 * booking order, which is correct and stays. But a customer who pays when the trip starts and asks
 * for an extra day at nine that evening has an order that was raised, captured and closed hours
 * before the day existed — a gateway order's amount cannot be edited once its id is in a customer's
 * hands. Before this, that money went to a `SETTLEMENT` order raised by `CompleteTripUseCase` that
 * no route and no screen ever showed anybody: billed on the receipt, never collected.
 *
 * SO THE EXTRA GETS ITS OWN CHECKOUT, opened by the customer, exactly like the fare's. The booking
 * order is left completely alone — a customer may be mid-checkout on it — and `paidExtensionPaise`
 * is the single figure reconciling however many orders end up carrying the extension.
 *
 * NOTHING IS MARKED PAID HERE. This opens an order; capture arrives by webhook or by the app's own
 * `extras/verify`, and only that increments `paidExtensionPaise`. An order raised and abandoned
 * must leave the booking exactly as it was, still owing.
 */
export class PayTripExtrasUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly payments: PaymentsContract,
    private readonly extensions: ExtensionRepositoryPort,
  ) {}

  async execute(input: PayTripExtrasInput): Promise<TripExtrasOrder> {
    const booking = await loadForCustomer(this.repo, input.bookingId, input.customerId);

    if (booking.status !== 'STARTED') {
      throw AppError.badRequest('You can only pay for an extra day while the trip is running.');
    }

    /*
     * CASH IS NOT A FAILURE HERE, it is a different settlement: the driver takes fare plus extras
     * at the door, and `expectedCashPaise` already says so. Refused rather than silently opening a
     * gateway order, which would collect the extra twice.
     *
     * A PREPAID trip may pay its extra day online here: the prepaid fare never covered it, and
     * paying it bumps `paidExtensionPaise`, which the completion settlement subtracts.
     */
    if (booking.paymentMode !== 'UPI' && booking.paymentMode !== 'PREPAID') {
      throw AppError.badRequest(
        'This trip is being paid in cash — hand the extra to your driver at the end.',
      );
    }

    const extras = totalExtension(await this.extensions.listForBooking(booking.id));
    const owedPaise = extras.amountPaise - booking.paidExtensionPaise;

    if (owedPaise <= 0) {
      throw AppError.badRequest('There is nothing extra to pay on this trip.');
    }

    const { payment, clientToken, publicKey } = await this.payments.charge({
      bookingId: booking.id,
      customerId: booking.customerId,
      kind: 'EXTENSION',
      amountPaise: owedPaise,
      reference: booking.reference,
      /*
       * KEYED ON THE DAY COUNT, not on a client-supplied uuid and not on the booking alone.
       *
       * On the booking alone, a customer who extends a second time would be handed back the first
       * day's order and pay half of what they owe. On a fresh key per tap, a customer who taps Pay
       * twice opens two orders for the same day. The number of accepted days is exactly the thing
       * that changes when — and only when — there is genuinely a new amount to collect.
       *
       * A hyphen, not a colon: the gateway's idempotency charset excludes it.
       */
      idempotencyKey: `extras-${booking.id}-${String(extras.days)}`,
    });

    logger.info(
      { bookingId: booking.id, reference: booking.reference, paymentId: payment.id, owedPaise },
      'opened an order for the day extension',
    );

    return {
      paymentId: payment.id,
      clientToken,
      publicKey,
      amountPaise: owedPaise,
    };
  }
}
