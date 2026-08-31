import type { Router } from 'express';
import type { PaymentsPublicContract } from './payments.public.js';
import { MongoPaymentRepository } from './infrastructure/paymentRepository.impl.js';
import { MockPaymentGateway } from './infrastructure/mock.gateway.js';
import { CreatePaymentUseCase } from './application/useCases/createPayment.usecase.js';
import { RefundPaymentUseCase } from './application/useCases/refundPayment.usecase.js';
import {
  HandleWebhookUseCase,
  type WebhookOutcome,
} from './application/useCases/handleWebhook.usecase.js';
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
 * `MockPaymentGateway` throws on construction in production, so selecting it there fails at boot
 * rather than quietly confirming bookings that collected nothing. When the real adapter exists,
 * the choice is an `if (isProduction)` here and nothing else in the module changes.
 */
export function buildPaymentsContainer(): PaymentsContainer {
  const repo = new MongoPaymentRepository();
  const gateway = new MockPaymentGateway();

  const create = new CreatePaymentUseCase(repo, gateway);
  const refund = new RefundPaymentUseCase(repo, gateway);
  const webhook = new HandleWebhookUseCase(repo, gateway);

  return {
    contract: {
      charge: (input) => create.execute(input),
      refund: (input) => refund.execute(input),
      findById: (id) => repo.findById(id),
      listForBooking: (bookingId) => repo.listForBooking(bookingId),
    },
    buildWebhookRouter: (onSettled) =>
      buildWebhookRouter({ webhook: makeWebhookController(webhook, onSettled) }),
  };
}
