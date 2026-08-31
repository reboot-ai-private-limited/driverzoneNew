import { isCaptured, type Payment } from '../../domain/payment.entity.js';
import { PaymentNotFoundError, PaymentStateError } from '../../domain/payment.errors.js';
import type { PaymentGatewayPort } from '../../domain/paymentGateway.port.js';
import type { PaymentRepositoryPort } from '../../domain/paymentRepository.port.js';

export interface RefundInput {
  paymentId: string;
  /** Omit to refund everything still refundable. */
  amountPaise?: number | undefined;
  idempotencyKey: string;
}

/**
 * Sends money back.
 *
 * Called from the cancellation path — where the customer gets back what they paid MINUS the
 * ladder fee — and from `NO_DRIVER_FOUND`, where they get all of it. Neither of those touches the
 * fare snapshot: the snapshot is what was agreed, and a refund is a separate movement recorded
 * against the payment.
 *
 * The gateway is called BEFORE the row is updated, and that order is deliberate. A refund we
 * recorded but never sent is a customer who is owed money nobody knows about; a refund we sent
 * but failed to record is visible in the provider's dashboard and reconcilable. Given one has to
 * be possible, it should be the recoverable one.
 */
export class RefundPaymentUseCase {
  constructor(
    private readonly repo: PaymentRepositoryPort,
    private readonly gateway: PaymentGatewayPort,
  ) {}

  async execute(input: RefundInput): Promise<Payment> {
    const payment = await this.repo.findById(input.paymentId);
    if (payment === null) throw new PaymentNotFoundError(input.paymentId);

    if (!isCaptured(payment.status)) {
      throw new PaymentStateError('Only a captured payment can be refunded', {
        status: payment.status,
      });
    }

    /*
     * The PAYMENT id, falling back to the order id.
     *
     * Razorpay refunds are `POST /v1/payments/:id/refund` — against the payment, which only exists
     * once someone has paid, so it arrives with the capture webhook rather than at order creation.
     * `gatewayRef` holds the ORDER, and refunding with that hits the wrong resource. The fallback
     * is for the mock gateway, where the two are the same string.
     */
    const refundTarget = payment.providerPaymentId ?? payment.gatewayRef;
    if (refundTarget === null) {
      throw new PaymentStateError('This payment has no gateway reference to refund against');
    }

    const refundable = payment.amountPaise - payment.refundedPaise;
    const amountPaise = input.amountPaise ?? refundable;

    if (amountPaise <= 0) {
      throw new PaymentStateError('Nothing left to refund on this payment', {
        amountPaise: payment.amountPaise,
        refundedPaise: payment.refundedPaise,
      });
    }
    if (amountPaise > refundable) {
      throw new PaymentStateError('Refund exceeds what remains captured on this payment', {
        requestedPaise: amountPaise,
        refundablePaise: refundable,
      });
    }

    await this.gateway.refund({
      gatewayRef: refundTarget,
      amountPaise,
      idempotencyKey: input.idempotencyKey,
    });

    const totalRefunded = payment.refundedPaise + amountPaise;
    const next = totalRefunded >= payment.amountPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    const updated = await this.repo.transition(payment.id, payment.status, next, {
      refundedPaise: totalRefunded,
    });

    /*
     * Losing this swap means the provider's own webhook recorded the refund between our call and
     * our write. The money went back either way, so the stored row is the answer — not an error.
     */
    return updated ?? (await this.repo.findById(payment.id)) ?? payment;
  }
}
