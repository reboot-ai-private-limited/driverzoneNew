import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env, isProduction } from '../../../config/env.js';
import { logger } from '../../../shared/logging/logger.js';
import {
  IGNORED_WEBHOOK,
  type GatewayEvent,
  type PaymentGatewayPort,
  type PaymentIntent,
  type QrCodeIntent,
  type RefundResult,
  type WebhookRequest,
} from '../domain/paymentGateway.port.js';

/**
 * INFRASTRUCTURE — a payment gateway that moves no money.
 *
 * It exists so the booking flow can be walked end to end, including the parts that are hard to
 * get right and easy to skip: an asynchronous capture, a redelivered webhook, a signature that
 * has to verify. Those paths are exercised from the first day rather than discovered broken when
 * a real provider is wired in.
 *
 * REFUSES TO RUN IN PRODUCTION, and this one genuinely must — unlike the mock push sender, which
 * merely fails to deliver, a mock gateway in production reports every booking as paid while
 * collecting nothing. Same guard as `otpSender.log.ts`.
 *
 * SIGNS ITS WEBHOOKS FOR REAL, with `PAYMENT_WEBHOOK_SECRET` and a constant-time compare. A mock
 * that skipped verification would leave the single most security-sensitive line in the payment
 * path — an unauthenticated public endpoint that confirms bookings — untested until launch.
 */
export class MockPaymentGateway implements PaymentGatewayPort {
  constructor(private readonly autoCapture: boolean = env.MOCK_PAYMENT_AUTO_CAPTURE) {
    if (isProduction) {
      throw new Error(
        'MockPaymentGateway must never run in production — it confirms bookings without collecting money',
      );
    }
  }

  async createIntent(input: {
    amountPaise: number;
    reference: string;
    idempotencyKey: string;
  }): Promise<PaymentIntent> {
    const gatewayRef = `mock_pay_${randomUUID()}`;

    logger.info(
      { gatewayRef, amountPaise: input.amountPaise, reference: input.reference },
      'mock gateway: created a payment intent',
    );

    return {
      gatewayRef,
      clientToken: `mock_token_${gatewayRef}`,
      // No publishable key exists for a gateway that talks to nobody.
      publicKey: null,
      capturedImmediately: this.autoCapture,
    };
  }

  async capture(gatewayRef: string, amountPaise: number): Promise<void> {
    logger.info({ gatewayRef, amountPaise }, 'mock gateway: captured an authorised payment');
  }

  async refund(input: {
    gatewayRef: string;
    amountPaise: number;
    idempotencyKey: string;
  }): Promise<RefundResult> {
    const refundRef = `mock_rfnd_${randomUUID()}`;
    logger.info(
      { of: input.gatewayRef, refundRef, amountPaise: input.amountPaise },
      'mock gateway: refunded',
    );
    return { gatewayRef: refundRef, amountPaise: input.amountPaise };
  }

  verifyWebhook(request: WebhookRequest): GatewayEvent | typeof IGNORED_WEBHOOK | null {
    if (!verifySignature(request.rawBody, request.signature)) return null;

    try {
      const parsed: unknown = JSON.parse(request.rawBody);
      return asGatewayEvent(parsed) ?? IGNORED_WEBHOOK;
    } catch {
      // A body that verified but does not parse is our own bug, not an attack — authentic, but not
      // an event, so it is answered 200 and not redelivered.
      return IGNORED_WEBHOOK;
    }
  }

  /**
   * QR codes the mock has handed out, and which of them a "customer" has paid. In memory — it is a
   * stand-in for a provider, and a restart is the same as the provider having forgotten.
   */
  private static readonly qrAmounts = new Map<string, number>();
  private static readonly paidQrs = new Map<string, { providerPaymentId: string; amountPaise: number }>();

  async createQrCode(input: {
    amountPaise: number;
    reference: string;
    idempotencyKey: string;
    expiresAt: Date;
  }): Promise<QrCodeIntent> {
    const gatewayRef = `mock_qr_${randomUUID()}`;
    MockPaymentGateway.qrAmounts.set(gatewayRef, input.amountPaise);

    logger.info(
      { gatewayRef, amountPaise: input.amountPaise, reference: input.reference },
      'mock gateway: created a QR code',
    );

    return {
      gatewayRef,
      // A real-looking UPI link, so the app draws a genuine QR. Scanning it pays nobody — nobody
      // owns `mock@driverzone`; use `payQr` (tests) or a signed webhook (a local walkthrough).
      upiUri: `upi://pay?pa=mock@driverzone&pn=DriverZone&am=${(input.amountPaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(input.reference)}&tr=${gatewayRef}`,
      imageUrl: null,
    };
  }

  async closeQrCode(gatewayRef: string): Promise<void> {
    logger.info({ gatewayRef }, 'mock gateway: closed a QR code');
  }

  async fetchQrCredit(
    gatewayRef: string,
  ): Promise<{ providerPaymentId: string; amountPaise: number } | null> {
    return MockPaymentGateway.paidQrs.get(gatewayRef) ?? null;
  }

  /** Pays a mock QR, as a customer scanning it would. Tests and local walkthroughs only. */
  static payQr(gatewayRef: string): void {
    const amountPaise = MockPaymentGateway.qrAmounts.get(gatewayRef);
    if (amountPaise === undefined) throw new Error(`no such mock QR: ${gatewayRef}`);
    MockPaymentGateway.paidQrs.set(gatewayRef, { providerPaymentId: `mock_qrpay_${randomUUID()}`, amountPaise });
  }

  /**
   * Builds a correctly signed webhook body, so a test or a local walkthrough can drive the
   * capture path through the REAL endpoint instead of reaching past it into the use case.
   */
  static signedWebhook(event: GatewayEvent): { body: string; signature: string } {
    const body = JSON.stringify(event);
    return { body, signature: sign(body) };
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    return signCheckout(orderId, paymentId) === signature;
  }

  /**
   * The checkout-side counterpart to `signedWebhook` — lets a test or a local walkthrough produce
   * the `razorpay_payment_id`/`razorpay_signature` pair a real checkout SDK would hand back, so
   * `VerifyCheckoutUseCase` can be driven end to end without a real Razorpay account.
   */
  static signedCheckout(orderId: string, paymentId: string): { paymentId: string; signature: string } {
    return { paymentId, signature: signCheckout(orderId, paymentId) };
  }
}

function sign(rawBody: string): string {
  return createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex');
}

/** Same secret as the webhook signature — the mock has only the one, unlike Razorpay's two. */
function signCheckout(orderId: string, paymentId: string): string {
  return createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
}

/**
 * Constant-time, and length-checked first because `timingSafeEqual` throws on a length mismatch
 * rather than returning false.
 */
function verifySignature(rawBody: string, signature: string): boolean {
  const expected = Buffer.from(sign(rawBody), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const EVENT_TYPES = new Set([
  'PAYMENT_AUTHORIZED',
  'PAYMENT_CAPTURED',
  'PAYMENT_FAILED',
  'REFUND_COMPLETED',
  'QR_CLOSED',
]);

/** Narrows a verified body. A signed body is trusted for authorship, never for shape. */
function asGatewayEvent(value: unknown): GatewayEvent | null {
  if (typeof value !== 'object' || value === null) return null;

  const raw = value as Record<string, unknown>;
  if (typeof raw['eventId'] !== 'string') return null;
  if (typeof raw['gatewayRef'] !== 'string') return null;
  if (typeof raw['type'] !== 'string' || !EVENT_TYPES.has(raw['type'])) return null;
  if (typeof raw['amountPaise'] !== 'number' || !Number.isInteger(raw['amountPaise'])) return null;

  return {
    eventId: raw['eventId'],
    type: raw['type'] as GatewayEvent['type'],
    gatewayRef: raw['gatewayRef'],
    amountPaise: raw['amountPaise'],
    failureReason: typeof raw['failureReason'] === 'string' ? raw['failureReason'] : undefined,
  };
}
