import { logger } from '../../../../shared/logging/logger.js';
import type { PaymentGatewayPort } from '../../domain/paymentGateway.port.js';
import type { PaymentRepositoryPort } from '../../domain/paymentRepository.port.js';
import { isCaptured } from '../../domain/payment.entity.js';
import { captureIfPending } from './handleWebhook.usecase.js';

export interface VerifyCheckoutInput {
  paymentId: string;
  providerPaymentId: string;
  signature: string;
}

/**
 * The checkout-callback counterpart to `HandleWebhookUseCase` — verifies the signature a
 * checkout SDK hands the app on success and, if it holds up, captures the payment immediately
 * rather than making the caller wait out the webhook.
 *
 * NEVER THE SOLE CONFIRMATION. The signature is over `orderId|paymentId` with OUR stored
 * `gatewayRef` as the order id — never a client-supplied one, which a forger could pair with any
 * payment id of their choosing. A webhook still arrives independently and settles the same row
 * through `captureIfPending`, which is why this and the webhook path share that one function:
 * whichever messenger gets there first does the work, and the other is a no-op compare-and-swap.
 */
export class VerifyCheckoutUseCase {
  constructor(
    private readonly repo: PaymentRepositoryPort,
    private readonly gateway: PaymentGatewayPort,
  ) {}

  async execute(input: VerifyCheckoutInput): Promise<{ captured: boolean }> {
    const payment = await this.repo.findById(input.paymentId);
    if (payment === null || payment.gatewayRef === null) return { captured: false };

    if (isCaptured(payment.status)) return { captured: true };

    const verified = this.gateway.verifyCheckoutSignature(
      payment.gatewayRef,
      input.providerPaymentId,
      input.signature,
    );
    if (!verified) {
      logger.warn({ paymentId: input.paymentId }, 'checkout signature did not verify');
      return { captured: false };
    }

    const captured = await captureIfPending(this.repo, input.paymentId, input.providerPaymentId);
    return { captured: captured !== null };
  }
}
