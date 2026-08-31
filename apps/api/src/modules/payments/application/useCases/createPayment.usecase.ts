import { logger } from '../../../../shared/logging/logger.js';
import type { Payment, PaymentKind } from '../../domain/payment.entity.js';
import type { PaymentGatewayPort } from '../../domain/paymentGateway.port.js';
import type { PaymentRepositoryPort } from '../../domain/paymentRepository.port.js';

export interface CreatePaymentInput {
  bookingId: string;
  customerId: string;
  kind: PaymentKind;
  amountPaise: number;
  /** Ours — the booking's human reference, so the provider's dashboard reconciles with ours. */
  reference: string;
  idempotencyKey: string;
}

export interface CreatedPayment {
  payment: Payment;
  /** Handed to the app for the provider's SDK. Null when the payment was already settled. */
  clientToken: string | null;
}

/**
 * Starts a charge.
 *
 * IDEMPOTENT ON THE CALLER'S KEY, in two layers. The repository's unique index makes the row
 * unique; this use case additionally notices when the row it got back was already past `CREATED`
 * and returns it untouched rather than creating a second intent at the gateway. Without the
 * second check a retry charges once in our database and twice at the provider.
 */
export class CreatePaymentUseCase {
  constructor(
    private readonly repo: PaymentRepositoryPort,
    private readonly gateway: PaymentGatewayPort,
  ) {}

  async execute(input: CreatePaymentInput): Promise<CreatedPayment> {
    const payment = await this.repo.create({
      bookingId: input.bookingId,
      customerId: input.customerId,
      kind: input.kind,
      amountPaise: input.amountPaise,
      idempotencyKey: input.idempotencyKey,
    });

    // Already in flight or already settled: the caller is retrying, and the answer is whatever
    // happened the first time.
    if (payment.status !== 'CREATED') {
      return { payment, clientToken: null };
    }

    const intent = await this.gateway.createIntent({
      amountPaise: input.amountPaise,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
    });

    await this.repo.attachGatewayRef(payment.id, intent.gatewayRef);

    /*
     * The reference is attached BEFORE the status moves, and that order is load-bearing: a crash
     * between the two leaves a payment stuck at CREATED but findable by its gateway ref, so a
     * webhook that arrives anyway can still be matched to it. The other order loses the money.
     */
    const pending = await this.repo.transition(payment.id, 'CREATED', 'PENDING', {
      gatewayRef: intent.gatewayRef,
    });

    if (pending === null) {
      logger.warn(
        { paymentId: payment.id },
        'payment left CREATED before we could mark it pending — returning the stored row',
      );
      return { payment: (await this.repo.findById(payment.id)) ?? payment, clientToken: null };
    }

    /*
     * A provider that settles synchronously sends no webhook, so nothing else would ever move
     * this off PENDING. Capturing here closes that gap; the transition is a compare-and-swap, so
     * a webhook arriving anyway simply loses the race and does nothing.
     */
    if (intent.capturedImmediately) {
      const captured = await this.repo.transition(pending.id, 'PENDING', 'CAPTURED');
      return { payment: captured ?? pending, clientToken: intent.clientToken };
    }

    return { payment: pending, clientToken: intent.clientToken };
  }
}
