import { logger } from '../../../../shared/logging/logger.js';
import { isCaptured } from '../../domain/payment.entity.js';
import { WebhookSignatureError } from '../../domain/payment.errors.js';
import type { GatewayEvent, PaymentGatewayPort } from '../../domain/paymentGateway.port.js';
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

  async execute(rawBody: string, signature: string): Promise<WebhookOutcome> {
    const event = this.gateway.verifyWebhook(rawBody, signature);
    if (event === null) throw new WebhookSignatureError();

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

    return this.apply(event, payment.id, payment.bookingId, payment.status, payment.refundedPaise);
  }

  private async apply(
    event: GatewayEvent,
    paymentId: string,
    bookingId: string,
    status: Parameters<PaymentRepositoryPort['transition']>[1],
    refundedPaise: number,
  ): Promise<WebhookOutcome> {
    if (event.type === 'PAYMENT_CAPTURED') {
      const captured = await this.repo.transition(paymentId, 'PENDING', 'CAPTURED');
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
