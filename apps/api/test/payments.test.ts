import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreatePaymentUseCase } from '../src/modules/payments/application/useCases/createPayment.usecase.js';
import { HandleWebhookUseCase } from '../src/modules/payments/application/useCases/handleWebhook.usecase.js';
import { RefundPaymentUseCase } from '../src/modules/payments/application/useCases/refundPayment.usecase.js';
import { VerifyCheckoutUseCase } from '../src/modules/payments/application/useCases/verifyCheckout.usecase.js';
import { canTransition, type Payment, type PaymentStatus } from '../src/modules/payments/domain/payment.entity.js';
import type {
  CreatePaymentData,
  PaymentRepositoryPort,
} from '../src/modules/payments/domain/paymentRepository.port.js';
import { MockPaymentGateway } from '../src/modules/payments/infrastructure/mock.gateway.js';
import type { GatewayEvent } from '../src/modules/payments/domain/paymentGateway.port.js';

/**
 * The gateway here is the real `MockPaymentGateway`, not a fake of it — its signing and
 * verification are the parts most worth exercising, and stubbing them would test nothing.
 */

class FakePaymentRepo implements PaymentRepositoryPort {
  readonly rows = new Map<string, Payment>();
  private readonly events = new Set<string>();
  private next = 0;

  async create(data: CreatePaymentData): Promise<Payment> {
    const existing = [...this.rows.values()].find((p) => p.idempotencyKey === data.idempotencyKey);
    if (existing !== undefined) return existing;

    const payment: Payment = {
      id: `pay_${(this.next += 1)}`,
      bookingId: data.bookingId,
      customerId: data.customerId,
      kind: data.kind,
      status: 'CREATED',
      amountPaise: data.amountPaise,
      refundedPaise: 0,
      gatewayRef: null,
      idempotencyKey: data.idempotencyKey,
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(payment.id, payment);
    return payment;
  }

  async findById(id: string): Promise<Payment | null> {
    return this.rows.get(id) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<Payment | null> {
    return [...this.rows.values()].find((p) => p.idempotencyKey === key) ?? null;
  }

  async findByGatewayRef(gatewayRef: string): Promise<Payment | null> {
    return [...this.rows.values()].find((p) => p.gatewayRef === gatewayRef) ?? null;
  }

  async listForBooking(bookingId: string): Promise<Payment[]> {
    return [...this.rows.values()].filter((p) => p.bookingId === bookingId);
  }

  async transition(
    id: string,
    from: PaymentStatus,
    to: PaymentStatus,
    patch: { gatewayRef?: string; failureReason?: string; refundedPaise?: number } = {},
  ): Promise<Payment | null> {
    const row = this.rows.get(id);
    if (row === undefined || row.status !== from) return null;

    const updated: Payment = { ...row, ...patch, status: to, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async attachGatewayRef(id: string, gatewayRef: string): Promise<Payment | null> {
    const row = this.rows.get(id);
    if (row === undefined) return null;
    const updated = { ...row, gatewayRef };
    this.rows.set(id, updated);
    return updated;
  }

  async markEventProcessed(eventId: string): Promise<boolean> {
    if (this.events.has(eventId)) return false;
    this.events.add(eventId);
    return true;
  }
}

const charge = {
  bookingId: 'bkg_1',
  customerId: 'cus_1',
  kind: 'BOOKING' as const,
  amountPaise: 105_000,
  reference: 'DZ-8F3K2M',
  idempotencyKey: 'idem_1',
};

let repo: FakePaymentRepo;

beforeEach(() => {
  repo = new FakePaymentRepo();
});

describe('payment state machine', () => {
  it('allows only the documented moves', () => {
    expect(canTransition('CREATED', 'PENDING')).toBe(true);
    expect(canTransition('PENDING', 'CAPTURED')).toBe(true);
    expect(canTransition('CAPTURED', 'REFUNDED')).toBe(true);
  });

  it('lets a FAILED payment still capture — the UPI retry Razorpay documents', () => {
    /*
     * The one exit from FAILED, and it is not defensive programming: Razorpay warns that a UPI
     * retry can deliver `payment.failed` and then `payment.captured` for a single transaction.
     * Without this the customer's money moves and the booking expires anyway.
     */
    expect(canTransition('FAILED', 'CAPTURED')).toBe(true);
  });

  it('still refuses every other resurrection', () => {
    expect(canTransition('REFUNDED', 'CAPTURED')).toBe(false);
    expect(canTransition('CREATED', 'CAPTURED')).toBe(false);
    expect(canTransition('FAILED', 'PENDING')).toBe(false);
    expect(canTransition('FAILED', 'REFUNDED')).toBe(false);
  });
});

describe('CreatePaymentUseCase', () => {
  it('captures immediately when the gateway settles synchronously', async () => {
    const gateway = new MockPaymentGateway(true);
    const { payment, clientToken } = await new CreatePaymentUseCase(repo, gateway).execute(charge);

    expect(payment.status).toBe('CAPTURED');
    expect(payment.gatewayRef).toMatch(/^mock_pay_/);
    expect(clientToken).toMatch(/^mock_token_/);
  });

  it('leaves the payment pending when the gateway will call back', async () => {
    const gateway = new MockPaymentGateway(false);
    const { payment } = await new CreatePaymentUseCase(repo, gateway).execute(charge);
    expect(payment.status).toBe('PENDING');
  });

  it('charges once for a double-tapped Confirm', async () => {
    const gateway = new MockPaymentGateway(true);
    const createIntent = vi.spyOn(gateway, 'createIntent');
    const useCase = new CreatePaymentUseCase(repo, gateway);

    const first = await useCase.execute(charge);
    const second = await useCase.execute(charge);

    expect(second.payment.id).toBe(first.payment.id);
    expect(createIntent).toHaveBeenCalledOnce();
    expect(repo.rows.size).toBe(1);
  });

  it('treats a different key as a genuinely different charge', async () => {
    const useCase = new CreatePaymentUseCase(repo, new MockPaymentGateway(true));
    await useCase.execute(charge);
    await useCase.execute({ ...charge, idempotencyKey: 'idem_2', kind: 'SETTLEMENT' });
    expect(repo.rows.size).toBe(2);
  });
});

describe('HandleWebhookUseCase', () => {
  const gateway = new MockPaymentGateway(false);

  async function pendingPayment(): Promise<Payment> {
    const { payment } = await new CreatePaymentUseCase(repo, gateway).execute(charge);
    return payment;
  }

  function deliver(event: GatewayEvent) {
    const { body, signature } = MockPaymentGateway.signedWebhook(event);
    return new HandleWebhookUseCase(repo, gateway).execute({
      rawBody: body,
      signature,
      // The mock puts the id in the body; a real provider sends it as a header. Passing it here
      // exercises the header path, which is the one that actually runs in production.
      eventId: event.eventId,
    });
  }

  it('captures a pending payment', async () => {
    const payment = await pendingPayment();
    const outcome = await deliver({
      eventId: 'evt_1',
      type: 'PAYMENT_CAPTURED',
      gatewayRef: payment.gatewayRef ?? '',
      amountPaise: payment.amountPaise,
    });

    expect(outcome).toEqual({
      handled: true,
      kind: 'CAPTURED',
      paymentId: payment.id,
      bookingId: 'bkg_1',
    });
    expect((await repo.findById(payment.id))?.status).toBe('CAPTURED');
  });

  it('rejects a body whose signature does not verify', async () => {
    const payment = await pendingPayment();
    const { body } = MockPaymentGateway.signedWebhook({
      eventId: 'evt_2',
      type: 'PAYMENT_CAPTURED',
      gatewayRef: payment.gatewayRef ?? '',
      amountPaise: 1,
    });

    await expect(
      new HandleWebhookUseCase(repo, gateway).execute({
        rawBody: body,
        signature: 'not-the-signature',
        eventId: 'evt_2',
      }),
    ).rejects.toThrow(/Signature verification failed/);
  });

  it('rejects a tampered body that kept a valid signature for different content', async () => {
    const payment = await pendingPayment();
    const { signature } = MockPaymentGateway.signedWebhook({
      eventId: 'evt_3',
      type: 'PAYMENT_CAPTURED',
      gatewayRef: payment.gatewayRef ?? '',
      amountPaise: 100,
    });

    const tampered = JSON.stringify({
      eventId: 'evt_3',
      type: 'PAYMENT_CAPTURED',
      gatewayRef: payment.gatewayRef,
      amountPaise: 999_999,
    });

    await expect(
      new HandleWebhookUseCase(repo, gateway).execute({
        rawBody: tampered,
        signature,
        eventId: 'evt_3',
      }),
    ).rejects.toThrow();
  });

  it('does nothing on a redelivered event', async () => {
    const payment = await pendingPayment();
    const event: GatewayEvent = {
      eventId: 'evt_4',
      type: 'PAYMENT_CAPTURED',
      gatewayRef: payment.gatewayRef ?? '',
      amountPaise: payment.amountPaise,
    };

    expect((await deliver(event)).handled).toBe(true);
    expect(await deliver(event)).toEqual({ handled: false, reason: 'REPLAY' });
  });

  it('reports an event for an unknown payment without failing', async () => {
    const outcome = await deliver({
      eventId: 'evt_5',
      type: 'PAYMENT_CAPTURED',
      gatewayRef: 'mock_pay_nobody',
      amountPaise: 100,
    });
    expect(outcome).toEqual({ handled: false, reason: 'UNKNOWN_PAYMENT' });
  });

  it('records a decline with a customer-safe reason', async () => {
    const payment = await pendingPayment();
    const outcome = await deliver({
      eventId: 'evt_6',
      type: 'PAYMENT_FAILED',
      gatewayRef: payment.gatewayRef ?? '',
      amountPaise: payment.amountPaise,
      failureReason: 'Your bank declined the payment',
    });

    expect(outcome).toMatchObject({ handled: true, kind: 'FAILED' });
    const stored = await repo.findById(payment.id);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.failureReason).toBe('Your bank declined the payment');
  });
});

describe('RefundPaymentUseCase', () => {
  async function capturedPayment(): Promise<Payment> {
    const { payment } = await new CreatePaymentUseCase(repo, new MockPaymentGateway(true)).execute(
      charge,
    );
    return payment;
  }

  it('refunds the whole amount by default', async () => {
    const payment = await capturedPayment();
    const refunded = await new RefundPaymentUseCase(repo, new MockPaymentGateway(true)).execute({
      paymentId: payment.id,
      idempotencyKey: 'rfnd_1',
    });

    expect(refunded.status).toBe('REFUNDED');
    expect(refunded.refundedPaise).toBe(105_000);
  });

  it('records a partial refund as partial — the cancellation-fee case', async () => {
    // ₹1,050 paid, ₹100 cancellation fee kept, ₹950 back.
    const payment = await capturedPayment();
    const refunded = await new RefundPaymentUseCase(repo, new MockPaymentGateway(true)).execute({
      paymentId: payment.id,
      amountPaise: 95_000,
      idempotencyKey: 'rfnd_2',
    });

    expect(refunded.status).toBe('PARTIALLY_REFUNDED');
    expect(refunded.refundedPaise).toBe(95_000);
  });

  it('refuses to refund more than was captured', async () => {
    const payment = await capturedPayment();
    await expect(
      new RefundPaymentUseCase(repo, new MockPaymentGateway(true)).execute({
        paymentId: payment.id,
        amountPaise: 200_000,
        idempotencyKey: 'rfnd_3',
      }),
    ).rejects.toThrow(/exceeds what remains captured/);
  });

  it('refuses to refund twice past the captured total', async () => {
    const payment = await capturedPayment();
    const useCase = new RefundPaymentUseCase(repo, new MockPaymentGateway(true));

    await useCase.execute({ paymentId: payment.id, amountPaise: 95_000, idempotencyKey: 'a' });
    await useCase.execute({ paymentId: payment.id, amountPaise: 10_000, idempotencyKey: 'b' });

    await expect(
      useCase.execute({ paymentId: payment.id, amountPaise: 1, idempotencyKey: 'c' }),
    ).rejects.toThrow();
  });

  it('refuses to refund a payment that never captured', async () => {
    const { payment } = await new CreatePaymentUseCase(repo, new MockPaymentGateway(false)).execute(
      charge,
    );
    await expect(
      new RefundPaymentUseCase(repo, new MockPaymentGateway(true)).execute({
        paymentId: payment.id,
        idempotencyKey: 'rfnd_4',
      }),
    ).rejects.toThrow(/Only a captured payment can be refunded/);
  });
});

/**
 * The checkout callback's own path to a capture. Same compare-and-swap as the webhook — they
 * share `captureIfPending` — so the interesting cases here are the signature check and what
 * happens when both messengers arrive.
 */
describe('VerifyCheckoutUseCase', () => {
  const gateway = new MockPaymentGateway(false);

  async function pending(): Promise<Payment> {
    const { payment } = await new CreatePaymentUseCase(repo, gateway).execute(charge);
    return payment;
  }

  function verify(payment: Payment, providerPaymentId: string, signature: string) {
    return new VerifyCheckoutUseCase(repo, gateway).execute({
      paymentId: payment.id,
      providerPaymentId,
      signature,
    });
  }

  it('captures a pending payment when the signature verifies', async () => {
    const payment = await pending();
    const signed = MockPaymentGateway.signedCheckout(payment.gatewayRef ?? '', 'pay_rzp_1');

    const result = await verify(payment, signed.paymentId, signed.signature);

    expect(result.captured).toBe(true);
    expect(repo.rows.get(payment.id)?.status).toBe('CAPTURED');
    expect(repo.rows.get(payment.id)?.providerPaymentId).toBe('pay_rzp_1');
  });

  it('leaves the payment untouched when the signature does not verify', async () => {
    const payment = await pending();

    const result = await verify(payment, 'pay_rzp_1', 'forged');

    expect(result.captured).toBe(false);
    expect(repo.rows.get(payment.id)?.status).toBe('PENDING');
  });

  /*
   * A signature over SOMEBODY ELSE'S order. The server signs with its own stored `gatewayRef`,
   * never the one a caller hands it, so a correctly-signed message for a different order does not
   * verify against this payment.
   */
  it('refuses a signature made against a different order', async () => {
    const payment = await pending();
    const signed = MockPaymentGateway.signedCheckout('order_somebody_else', 'pay_rzp_1');

    const result = await verify(payment, signed.paymentId, signed.signature);

    expect(result.captured).toBe(false);
    expect(repo.rows.get(payment.id)?.status).toBe('PENDING');
  });

  /* Razorpay's documented UPI retry: failed, then captured for the same transaction. */
  it('captures from FAILED, the one exit that state has', async () => {
    const payment = await pending();
    await repo.transition(payment.id, 'PENDING', 'FAILED', { failureReason: 'upi timeout' });
    const signed = MockPaymentGateway.signedCheckout(payment.gatewayRef ?? '', 'pay_rzp_1');

    const result = await verify(payment, signed.paymentId, signed.signature);

    expect(result.captured).toBe(true);
    expect(repo.rows.get(payment.id)?.status).toBe('CAPTURED');
  });

  /* The webhook got there first. The caller still hears "captured" — because it is. */
  it('reports an already-captured payment as captured, without re-transitioning', async () => {
    const payment = await pending();
    await repo.transition(payment.id, 'PENDING', 'CAPTURED', {});
    const signed = MockPaymentGateway.signedCheckout(payment.gatewayRef ?? '', 'pay_rzp_1');

    const result = await verify(payment, signed.paymentId, signed.signature);

    expect(result.captured).toBe(true);
    expect(repo.rows.get(payment.id)?.status).toBe('CAPTURED');
  });

  it('reports an unknown payment as not captured rather than throwing', async () => {
    const result = await new VerifyCheckoutUseCase(repo, gateway).execute({
      paymentId: 'pay_nonexistent',
      providerPaymentId: 'pay_rzp_1',
      signature: 'anything',
    });

    expect(result.captured).toBe(false);
  });
});
