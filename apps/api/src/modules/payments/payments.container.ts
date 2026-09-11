import type { Router } from 'express';
import { env } from '../../config/env.js';
import { logger } from '../../shared/logging/logger.js';
import type { PaymentsPublicContract } from './payments.public.js';
import type { PaymentGatewayPort } from './domain/paymentGateway.port.js';
import { MongoPaymentRepository } from './infrastructure/paymentRepository.impl.js';
import { MockPaymentGateway } from './infrastructure/mock.gateway.js';
import { RazorpayGateway } from './infrastructure/razorpay.gateway.js';
import { CreatePaymentUseCase } from './application/useCases/createPayment.usecase.js';
import { RefundPaymentUseCase } from './application/useCases/refundPayment.usecase.js';
import {
  HandleWebhookUseCase,
  type WebhookOutcome,
} from './application/useCases/handleWebhook.usecase.js';
import { VerifyCheckoutUseCase } from './application/useCases/verifyCheckout.usecase.js';
import { makeWebhookController } from './interface/payments.controller.js';
import { buildWebhookRouter } from './interface/payments.routes.js';

/** What the booking side is told when a payment settles. Wired by the composition root. */
export type PaymentSettledHandler = (
  outcome: Extract<WebhookOutcome, { handled: true }>,
) => Promise<void>;

export interface PaymentsContainer {
  contract: PaymentsPublicContract;
  buildWebhookRouter: (onSettled: PaymentSettledHandler) => Router;
}

/**
 * The only file permitted to name a concrete gateway.
 *
 * Razorpay whenever its three secrets are configured; the mock otherwise. The mock throws on
 * construction in production, so a production deploy that forgot the keys dies at boot rather than
 * quietly confirming bookings that collected nothing — which is the failure this selection exists
 * to make impossible.
 */
function selectGateway(): PaymentGatewayPort {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } = env;

  if (
    RAZORPAY_KEY_ID !== undefined &&
    RAZORPAY_KEY_SECRET !== undefined &&
    RAZORPAY_WEBHOOK_SECRET !== undefined
  ) {
    logger.info(
      { mode: RAZORPAY_KEY_ID.startsWith('rzp_test') ? 'test' : 'live' },
      'payments: using Razorpay',
    );
    return new RazorpayGateway({
      keyId: RAZORPAY_KEY_ID,
      keySecret: RAZORPAY_KEY_SECRET,
      webhookSecret: RAZORPAY_WEBHOOK_SECRET,
    });
  }

  return new MockPaymentGateway();
}

export function buildPaymentsContainer(): PaymentsContainer {
  const repo = new MongoPaymentRepository();
  const gateway = selectGateway();

  const create = new CreatePaymentUseCase(repo, gateway);
  const refund = new RefundPaymentUseCase(repo, gateway);
  const webhook = new HandleWebhookUseCase(repo, gateway);
  const verifyCheckout = new VerifyCheckoutUseCase(repo, gateway);

  return {
    contract: {
      charge: (input) => create.execute(input),
      refund: (input) => refund.execute(input),
      findById: (id) => repo.findById(id),
      listForBooking: (bookingId) => repo.listForBooking(bookingId),
      verifyAndCapture: (input) => verifyCheckout.execute(input),
      // Same env var `selectGateway` above already gates on — null under the mock gateway.
      publicKey: env.RAZORPAY_KEY_ID ?? null,
    },
    buildWebhookRouter: (onSettled) =>
      buildWebhookRouter({ webhook: makeWebhookController(webhook, onSettled) }),
  };
}
