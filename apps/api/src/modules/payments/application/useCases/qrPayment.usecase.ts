import { logger } from '../../../../shared/logging/logger.js';
import { isCaptured, type Payment, type PaymentKind } from '../../domain/payment.entity.js';
import type { PaymentGatewayPort } from '../../domain/paymentGateway.port.js';
import type { PaymentRepositoryPort } from '../../domain/paymentRepository.port.js';
import { captureIfPending } from './handleWebhook.usecase.js';

export interface CreateQrPaymentInput {
  bookingId: string;
  customerId: string;
  kind: PaymentKind;
  amountPaise: number;
  reference: string;
  idempotencyKey: string;
  expiresAt: Date;
  /** Remembered with the charge, opaque here — see `Payment.metadata`. */
  metadata: Record<string, number>;
}

/**
 * Makes a single-use UPI QR for a trip and stores it as a PENDING payment.
 *
 * THE ROW IS WRITTEN BEFORE THE GATEWAY IS ASKED, under a unique idempotency key — the same order
 * `CreatePaymentUseCase` uses, and for the same reason. Razorpay's QR API has no idempotency header,
 * so the only thing standing between a double-tap and two live QR codes (two ways to pay one trip)
 * is that the second tap finds the first one's row and returns it.
 */
export class CreateQrPaymentUseCase {
  constructor(
    private readonly repo: PaymentRepositoryPort,
    private readonly gateway: PaymentGatewayPort,
  ) {}

  async execute(input: CreateQrPaymentInput): Promise<Payment> {
    const payment = await this.repo.create({
      bookingId: input.bookingId,
      customerId: input.customerId,
      kind: input.kind,
      amountPaise: input.amountPaise,
      idempotencyKey: input.idempotencyKey,
      channel: 'QR',
      metadata: input.metadata,
    });

    // A retry of a request that already got this far: the answer is whatever happened the first time.
    if (payment.status !== 'CREATED') return payment;

    try {
      const qr = await this.gateway.createQrCode({
        amountPaise: input.amountPaise,
        reference: input.reference,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
      });

      const pending = await this.repo.transition(payment.id, 'CREATED', 'PENDING', {
        gatewayRef: qr.gatewayRef,
        qr: { upiUri: qr.upiUri, imageUrl: qr.imageUrl, expiresAt: input.expiresAt },
      });

      return pending ?? (await this.repo.findById(payment.id)) ?? payment;
    } catch (error) {
      // The gateway said no. Leaving the row CREATED would make the retry below think a QR is
      // still being made, so it is closed out — the driver's next tap starts clean.
      await this.repo.transition(payment.id, 'CREATED', 'FAILED', {
        failureReason: 'The QR code could not be created',
      });
      throw error;
    }
  }
}

/**
 * Stops a QR taking payments — expired, replaced by a newer one, or the trip was paid another way.
 *
 * Closed AT THE GATEWAY first and in our books second, and neither failing blocks the other: a QR
 * that is already closed (paid, expired) makes the gateway call fail, and that is the outcome we
 * wanted. If the customer pays in the instant between the two, the credit still captures — a
 * `FAILED` payment may move to `CAPTURED` (see `captureIfPending`) — so money is never orphaned.
 */
export class CloseQrPaymentUseCase {
  constructor(
    private readonly repo: PaymentRepositoryPort,
    private readonly gateway: PaymentGatewayPort,
  ) {}

  async execute(paymentId: string, reason: string): Promise<void> {
    const payment = await this.repo.findById(paymentId);
    if (payment === null || payment.channel !== 'QR' || payment.status !== 'PENDING') return;

    if (payment.gatewayRef !== null) await this.gateway.closeQrCode(payment.gatewayRef);
    await this.repo.transition(payment.id, 'PENDING', 'FAILED', { failureReason: reason });
  }
}

export interface RefreshedQrPayment {
  payment: Payment;
  /** True only when THIS call made the capture — the flag to hang a once-only side effect off. */
  justCaptured: boolean;
}

/**
 * Asks the gateway whether a QR has been paid — the fallback for a webhook that is late, lost, or
 * cannot reach us at all (local development) — and expires one that ran out of time.
 *
 * The same compare-and-swap as the webhook (`captureIfPending`), so exactly one of the two ever
 * performs the capture and the caller can credit money on `justCaptured` without crediting twice.
 */
export class RefreshQrPaymentUseCase {
  /** When each QR was last put to the gateway. A driver's screen polls every couple of seconds. */
  private readonly lastAsked = new Map<string, number>();

  constructor(
    private readonly repo: PaymentRepositoryPort,
    private readonly gateway: PaymentGatewayPort,
    private readonly minIntervalMs = 3_000,
    private readonly now: () => number = Date.now,
  ) {}

  async execute(paymentId: string): Promise<RefreshedQrPayment | null> {
    const payment = await this.repo.findById(paymentId);
    if (payment === null || payment.channel !== 'QR') return null;
    if (isCaptured(payment.status)) return { payment, justCaptured: false };

    // `FAILED` is asked too: an expiry we recorded can still turn out to have been paid in time.
    if (payment.gatewayRef !== null && this.due(payment.id)) {
      try {
        const credit = await this.gateway.fetchQrCredit(payment.gatewayRef);
        if (credit !== null) return await this.capture(payment, credit);
      } catch (error) {
        // The gateway being down must not break the driver's screen — the webhook may still land.
        logger.warn({ err: error, paymentId }, 'could not ask the gateway whether a QR was paid');
      }
    }

    // Out of time and unpaid. Closed at the gateway too, so it cannot be paid after we said it died.
    if (
      payment.status === 'PENDING' &&
      payment.qr !== null &&
      payment.qr.expiresAt.getTime() <= this.now()
    ) {
      await new CloseQrPaymentUseCase(this.repo, this.gateway).execute(payment.id, 'The QR code expired');
      return { payment: (await this.repo.findById(payment.id)) ?? payment, justCaptured: false };
    }

    return { payment, justCaptured: false };
  }

  private async capture(
    payment: Payment,
    credit: { providerPaymentId: string; amountPaise: number },
  ): Promise<RefreshedQrPayment> {
    // The same check the webhook makes: a credit for the wrong amount is not a paid trip.
    if (credit.amountPaise !== payment.amountPaise) {
      logger.error(
        { paymentId: payment.id, expectedPaise: payment.amountPaise, creditedPaise: credit.amountPaise },
        'a QR was credited with an amount that is not what it was made for — NOT marking the trip paid',
      );
      return { payment, justCaptured: false };
    }

    const captured = await captureIfPending(this.repo, payment.id, credit.providerPaymentId);
    if (captured !== null) return { payment: captured, justCaptured: true };

    // Lost the swap — the webhook got there first. Report what is true now.
    return { payment: (await this.repo.findById(payment.id)) ?? payment, justCaptured: false };
  }

  private due(paymentId: string): boolean {
    const last = this.lastAsked.get(paymentId) ?? 0;
    const now = this.now();
    if (now - last < this.minIntervalMs) return false;
    this.lastAsked.set(paymentId, now);
    return true;
  }
}
