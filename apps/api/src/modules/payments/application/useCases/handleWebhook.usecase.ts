import { logger } from '../../../../shared/logging/logger.js';
import { isCaptured } from '../../domain/payment.entity.js';
import { WebhookSignatureError } from '../../domain/payment.errors.js';
import {
  IGNORED_WEBHOOK,
  type GatewayEvent,
  type PaymentGatewayPort,
  type WebhookRequest,
} from '../../domain/paymentGateway.port.js';
import type { PaymentRepositoryPort } from '../../domain/paymentRepository.port.js';

/**
 * What the webhook resolved to, so the caller can run the booking-side side effects.
 *
 * `handled: false` covers a replay and an event for a payment we do not recognise. Both answer
 * the provider with a 200 — a non-2xx makes them redeliver, and redelivering something we have
 * already processed or will never understand helps nobody.
 */
export type WebhookOutcome =
  | { handled: true; kind: 'CAPTURED' | 'FAILED' | 'REFUNDED'; paymentId: string; bookingId: string }
  | { handled: false; reason: 'REPLAY' | 'UNKNOWN_PAYMENT' | 'NOT_APPLICABLE' };

/**
 * Processes one webhook from the payment provider.
 *
 * THIS ENDPOINT IS UNAUTHENTICATED AND CONFIRMS BOOKINGS. The signature check is the only thing
 * between the internet and a free ride, so it happens first, before the body is parsed and before
 * anything is looked up.
 *
 * Then deduplication, then the state change. The order matters: claiming the event id before
 * acting means two simultaneous deliveries cannot both proceed, and the compare-and-swap on the
 * status means even if they somehow did, only one would take effect.
 */
export class HandleWebhookUseCase {
  constructor(
    private readonly repo: PaymentRepositoryPort,
    private readonly gateway: PaymentGatewayPort,
  ) {}

  async execute(request: WebhookRequest): Promise<WebhookOutcome> {
    const event = this.gateway.verifyWebhook(request);
    if (event === null) throw new WebhookSignatureError();

    // Authentic, but nothing for us to do — an event we never subscribed to, or a payment made on a
    // QR (whose own credit event is the one that counts). Answered 200: a 401 here would make the
    // provider redeliver it for hours and eventually flag the whole webhook as failing.
    if (event === IGNORED_WEBHOOK) return { handled: false, reason: 'NOT_APPLICABLE' };

    const isFirstDelivery = await this.repo.markEventProcessed(event.eventId);
    if (!isFirstDelivery) {
      logger.info({ eventId: event.eventId }, 'payment webhook replayed — ignoring');
      return { handled: false, reason: 'REPLAY' };
    }

    const payment = await this.repo.findByGatewayRef(event.gatewayRef);
    if (payment === null) {
      // Not necessarily an attack: a refund's own reference, or an event for an environment
      // sharing the provider account. Worth a warning, never a retry.
      logger.warn({ eventId: event.eventId, gatewayRef: event.gatewayRef }, 'payment webhook for an unknown payment');
      return { handled: false, reason: 'UNKNOWN_PAYMENT' };
    }

    return this.apply(
      event,
      payment.id,
      payment.bookingId,
      payment.status,
      payment.refundedPaise,
      payment.channel === 'QR' ? payment.amountPaise : null,
    );
  }

  private async apply(
    event: GatewayEvent,
    paymentId: string,
    bookingId: string,
    status: Parameters<PaymentRepositoryPort['transition']>[1],
    refundedPaise: number,
    /** The amount a QR was made for — null for an order, which the gateway itself holds to. */
    qrAmountPaise: number | null,
  ): Promise<WebhookOutcome> {
    /*
     * The money is held but not taken. Capture it, or the authorisation reverses itself after a
     * few days and a customer who was debited, and rode, is silently refunded. Correct whether or
     * not the account has auto-capture on: with it on, this event does not arrive.
     */
    if (event.type === 'PAYMENT_AUTHORIZED') {
      if (event.providerPaymentId === undefined) return { handled: false, reason: 'NOT_APPLICABLE' };
      await this.gateway.capture(event.providerPaymentId, event.amountPaise);
      return { handled: false, reason: 'NOT_APPLICABLE' };
    }

    /*
     * A QR that stopped taking payments WITHOUT being paid — it expired, or was closed on purpose.
     * Marked failed so the driver's screen can say so and offer a fresh one. No booking-side effect
     * (`handled: false`): an expired QR is not a failed payment the customer needs telling about.
     * A paid QR's own close is never reported — see `toQrEvent`.
     */
    if (event.type === 'QR_CLOSED') {
      await this.repo.transition(paymentId, 'PENDING', 'FAILED', {
        failureReason: 'The QR code expired',
      });
      return { handled: false, reason: 'NOT_APPLICABLE' };
    }

    if (event.type === 'PAYMENT_CAPTURED') {
      /*
       * A QR is fixed-amount, so a UPI app cannot send a different figure — but this is money
       * arriving by the internet, and "cannot happen" is a claim, not a check. A credit that does
       * not match is left UNCAPTURED so the trip is not marked paid on the wrong amount, and logged
       * loudly: the money is real and somebody has to deal with it.
       */
      if (qrAmountPaise !== null && event.amountPaise !== qrAmountPaise) {
        logger.error(
          { paymentId, expectedPaise: qrAmountPaise, creditedPaise: event.amountPaise },
          'a QR was credited with an amount that is not what it was made for — NOT marking the trip paid',
        );
        return { handled: false, reason: 'NOT_APPLICABLE' };
      }

      const captured = await captureIfPending(this.repo, paymentId, event.providerPaymentId);
      if (captured === null) return { handled: false, reason: 'NOT_APPLICABLE' };
      return { handled: true, kind: 'CAPTURED', paymentId, bookingId };
    }

    if (event.type === 'PAYMENT_FAILED') {
      const failed = await this.repo.transition(paymentId, 'PENDING', 'FAILED', {
        failureReason: event.failureReason ?? 'The payment could not be completed',
      });
      if (failed === null) return { handled: false, reason: 'NOT_APPLICABLE' };
      return { handled: true, kind: 'FAILED', paymentId, bookingId };
    }

    // REFUND_COMPLETED. Partial refunds accumulate, so the new total decides which terminal
    // state this lands in rather than assuming a refund is always the whole amount.
    if (!isCaptured(status)) return { handled: false, reason: 'NOT_APPLICABLE' };

    const payment = await this.repo.findById(paymentId);
    if (payment === null) return { handled: false, reason: 'UNKNOWN_PAYMENT' };

    const totalRefunded = refundedPaise + event.amountPaise;
    const next = totalRefunded >= payment.amountPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    const updated = await this.repo.transition(paymentId, status, next, {
      refundedPaise: totalRefunded,
    });
    if (updated === null) return { handled: false, reason: 'NOT_APPLICABLE' };

    return { handled: true, kind: 'REFUNDED', paymentId, bookingId };
  }
}

/**
 * FROM `PENDING` **OR** FROM `FAILED`, and the second one is not defensive programming.
 *
 * Razorpay documents that a UPI retry can deliver `payment.failed` and then `payment.captured`
 * for the same transaction. If capture could only follow `PENDING`, the customer's money would
 * have moved and this row would sit at `FAILED` forever — money out, no ride. The payment state
 * machine has one exit from `FAILED` for exactly this.
 *
 * Shared by `HandleWebhookUseCase` above and `VerifyCheckoutUseCase` — both learn of a capture
 * from a different messenger (the provider's server vs. the app's own checkout callback) but
 * apply the exact same compare-and-swap, so there is one place this logic can be gotten wrong
 * instead of two that can drift apart.
 */
export async function captureIfPending(
  repo: PaymentRepositoryPort,
  paymentId: string,
  providerPaymentId: string | undefined,
) {
  const patch = providerPaymentId === undefined ? {} : { providerPaymentId };
  return (
    (await repo.transition(paymentId, 'PENDING', 'CAPTURED', patch)) ??
    (await repo.transition(paymentId, 'FAILED', 'CAPTURED', patch))
  );
}
