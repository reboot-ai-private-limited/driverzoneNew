import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../shared/errors/AppError.js';
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
 * INFRASTRUCTURE — Razorpay.
 *
 * Raw `fetch` rather than the `razorpay` npm package. This is two endpoints and two HMACs;
 * `quotes/infrastructure/osrm.roadDistance.ts` already establishes the pattern for a small
 * outbound HTTP adapter, and an SDK here would be a dependency to keep current for no behaviour we
 * do not write out below.
 *
 * THREE FACTS THAT LOOK ALIKE AND ARE NOT:
 *
 *   1. `amount` is in PAISE — the same unit we store, so nothing converts anywhere.
 *   2. The WEBHOOK signature is HMAC-SHA256 of the raw body with the WEBHOOK secret.
 *   3. The CHECKOUT signature is HMAC-SHA256 of `order_id|payment_id` with the API KEY secret.
 *
 * Two different secrets and two different messages. Using one where the other belongs verifies
 * nothing and fails closed, which is the good outcome; the bad one is being tempted to "fix" it by
 * relaxing the check.
 */

const API = 'https://api.razorpay.com/v1';

/** Razorpay's cap. Our booking references are 9 characters, so this is only ever a guard. */
const MAX_RECEIPT_LENGTH = 40;

/** ₹1.00. Below this Razorpay refuses the order outright. */
const MIN_ORDER_PAISE = 100;

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  timeoutMs?: number;
}

export class RazorpayGateway implements PaymentGatewayPort {
  private readonly auth: string;
  private readonly timeoutMs: number;

  /**
   * Credentials are passed in rather than read from `env` here, because they are OPTIONAL in the
   * environment — the container decides between this and the mock by whether they are present, and
   * an adapter defaulting from optional config would construct itself with `undefined` and fail at
   * the first request instead of at boot.
   */
  constructor(private readonly config: RazorpayConfig) {
    this.auth = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async createIntent(input: {
    amountPaise: number;
    reference: string;
    idempotencyKey: string;
  }): Promise<PaymentIntent> {
    if (input.amountPaise < MIN_ORDER_PAISE) {
      throw AppError.internal('INTERNAL', {
        reason: 'Razorpay refuses an order below ₹1.00',
        amountPaise: input.amountPaise,
      });
    }

    /*
     * `receipt` is OUR reference and Razorpay requires it unique and ASCII within 40 characters.
     * The booking reference alone is not unique across a booking's payments — a fare and a later
     * settlement share it — so the idempotency key's tail disambiguates. It is also what makes a
     * row in their dashboard traceable to a row in ours, which is the whole reason to send it.
     *
     * There is NO idempotency header on the Orders API (unlike refunds). Our protection against a
     * duplicate order is the unique index on `payments.idempotencyKey`: a retry finds the existing
     * row before it ever reaches this method.
     */
    const receipt = `${input.reference}-${input.idempotencyKey}`
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, MAX_RECEIPT_LENGTH);

    const order = await this.post<{ id?: unknown; status?: unknown }>('/orders', {
      amount: input.amountPaise,
      currency: 'INR',
      receipt,
      notes: { reference: input.reference },
    });

    if (typeof order.id !== 'string') {
      throw AppError.internal('INTERNAL', { reason: 'Razorpay order response had no id' });
    }

    logger.info({ orderId: order.id, amountPaise: input.amountPaise, receipt }, 'razorpay order created');

    return {
      gatewayRef: order.id,
      clientToken: order.id,
      // The publishable half. The SDK needs it beside the order id; the secret never leaves here.
      publicKey: this.config.keyId,
      /*
       * ALWAYS false. A Razorpay order is not a payment — the customer has not paid yet, and the
       * outcome arrives by webhook however the account is configured. Claiming otherwise would
       * confirm bookings nobody has paid for.
       */
      capturedImmediately: false,
    };
  }

  async capture(gatewayRef: string, amountPaise: number): Promise<void> {
    // `gatewayRef` here is the PAYMENT id, passed by the caller from the authorised event.
    await this.post(`/payments/${gatewayRef}/capture`, { amount: amountPaise, currency: 'INR' });
    logger.info({ paymentId: gatewayRef, amountPaise }, 'razorpay payment captured');
  }

  async refund(input: {
    gatewayRef: string;
    amountPaise: number;
    idempotencyKey: string;
  }): Promise<RefundResult> {
    /*
     * `X-Refund-Idempotency` accepts only `[A-Za-z0-9_-]` and at least 10 characters, and a retry
     * must send an IDENTICAL body or it is rejected as a bad request. Sanitising here rather than
     * at the call site keeps that charset rule with the API that imposes it — the alternative is
     * every caller remembering it, which is how `refund:${bookingId}` shipped with a colon in it.
     */
    const key = idempotencyKeyFor(input.idempotencyKey);

    const refund = await this.post<{ id?: unknown; amount?: unknown }>(
      `/payments/${input.gatewayRef}/refund`,
      { amount: input.amountPaise },
      { 'X-Refund-Idempotency': key },
    );

    if (typeof refund.id !== 'string') {
      throw AppError.internal('INTERNAL', { reason: 'Razorpay refund response had no id' });
    }

    logger.info({ refundId: refund.id, of: input.gatewayRef, amountPaise: input.amountPaise }, 'razorpay refund created');

    return { gatewayRef: refund.id, amountPaise: input.amountPaise };
  }

  /**
   * A single-use UPI QR for exactly `amountPaise`.
   *
   * `fixed_amount: true` is what makes `single_use` legal — and what makes a UPI app refuse any
   * other amount, so a customer cannot underpay by editing the figure. `close_by` is a unix
   * timestamp in SECONDS. There is no idempotency header on this API, so duplicate QRs are
   * prevented the same way duplicate orders are: the caller creates our payment row first, under a
   * unique idempotency key, and only reaches here once.
   */
  async createQrCode(input: {
    amountPaise: number;
    reference: string;
    idempotencyKey: string;
    expiresAt: Date;
  }): Promise<QrCodeIntent> {
    if (input.amountPaise < MIN_ORDER_PAISE) {
      throw AppError.internal('INTERNAL', {
        reason: 'Razorpay refuses a payment below ₹1.00',
        amountPaise: input.amountPaise,
      });
    }

    const qr = await this.post<{ id?: unknown; image_url?: unknown; image_content?: unknown }>(
      '/payments/qr_codes',
      {
        type: 'upi_qr',
        name: `DriverZone ${input.reference}`.slice(0, 40),
        usage: 'single_use',
        fixed_amount: true,
        payment_amount: input.amountPaise,
        description: `Trip ${input.reference}`,
        close_by: Math.floor(input.expiresAt.getTime() / 1000),
        notes: { reference: input.reference },
      },
    );

    if (typeof qr.id !== 'string') {
      throw AppError.internal('INTERNAL', { reason: 'Razorpay QR response had no id' });
    }

    logger.info({ qrId: qr.id, amountPaise: input.amountPaise, reference: input.reference }, 'razorpay qr created');

    return {
      gatewayRef: qr.id,
      // Only a real UPI link is kept — `image_content` is not documented as one, so it is trusted
      // only when it looks like one, and the hosted image is the fallback otherwise.
      upiUri:
        typeof qr.image_content === 'string' && qr.image_content.startsWith('upi://')
          ? qr.image_content
          : null,
      imageUrl: typeof qr.image_url === 'string' ? qr.image_url : null,
    };
  }

  async closeQrCode(gatewayRef: string): Promise<void> {
    try {
      await this.post(`/payments/qr_codes/${gatewayRef}/close`, {});
    } catch (error) {
      // Closing a QR that is already closed (paid, expired) is a 400, and is exactly the outcome
      // wanted — so this is logged, not thrown.
      logger.warn({ err: error, qrId: gatewayRef }, 'razorpay qr could not be closed');
    }
  }

  async fetchQrCredit(
    gatewayRef: string,
  ): Promise<{ providerPaymentId: string; amountPaise: number } | null> {
    const list = await this.get<{ items?: unknown }>(`/payments/qr_codes/${gatewayRef}/payments`);
    const items = Array.isArray(list.items) ? (list.items as Array<Record<string, unknown>>) : [];

    // A QR's payments are auto-captured. `captured` is the only status that is money in hand.
    const paid = items.find(
      (item) => item['status'] === 'captured' && typeof item['id'] === 'string' && Number.isInteger(item['amount']),
    );
    if (paid === undefined) return null;

    return { providerPaymentId: paid['id'] as string, amountPaise: paid['amount'] as number };
  }

  verifyWebhook(request: WebhookRequest): GatewayEvent | typeof IGNORED_WEBHOOK | null {
    if (!this.signatureMatches(request.rawBody, request.signature)) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(request.rawBody);
    } catch {
      // Verified but unparseable is our problem, not an attack — answer 200, or it is redelivered
      // for hours and fails the same way every time.
      logger.error('razorpay webhook verified but did not parse');
      return IGNORED_WEBHOOK;
    }

    // Authentic, but nothing we act on (an event we never subscribed to; a payment made outside an
    // order, such as a QR payment's own `payment.captured`). Not the same answer as a bad signature.
    return toGatewayEvent(parsed, request.eventId) ?? IGNORED_WEBHOOK;
  }

  /**
   * The CHECKOUT signature — a different message and a different secret from the webhook.
   *
   * `hmac_sha256(order_id + "|" + payment_id, key_secret)`. The `orderId` passed here must be the
   * one read from OUR database, never the `razorpay_order_id` the client returned: a client that
   * can choose both halves of the message can sign it too.
   *
   * Called from `VerifyCheckoutUseCase` right after the app's own checkout resolves, so a
   * confirmed booking does not have to wait out the webhook. Webhooks remain the authority
   * regardless — this only lets the app stop waiting sooner.
   */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    const expected = createHmac('sha256', this.config.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return constantTimeEquals(expected, signature);
  }

  private signatureMatches(rawBody: string, signature: string): boolean {
    const expected = createHmac('sha256', this.config.webhookSecret).update(rawBody).digest('hex');
    return constantTimeEquals(expected, signature);
  }

  private get<T>(path: string): Promise<T> {
    return this.call<T>('GET', path);
  }

  private post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
    return this.call<T>('POST', path, body, headers);
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${API}${path}`, {
        method,
        headers: { authorization: this.auth, 'content-type': 'application/json', ...headers },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });

      const payload: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        /*
         * Razorpay's own description is for us, not for a customer — "The amount must be at least
         * INR 1.00" is fine, "BAD_REQUEST_ERROR" is not — so it goes in `details`, which is
         * stripped in production, and the caller decides what a customer sees.
         */
        throw AppError.internal('INTERNAL', {
          reason: 'Razorpay rejected the request',
          status: response.status,
          path,
          razorpay: readErrorDescription(payload),
        });
      }

      return payload as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ err: error, path }, 'razorpay unreachable');
      throw AppError.internal('INTERNAL', { reason: 'Could not reach the payment provider' }, error);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** `[A-Za-z0-9_-]` only, and at least 10 characters, per Razorpay's rule for the header. */
export function idempotencyKeyFor(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '-');
  return cleaned.length >= 10 ? cleaned : cleaned.padEnd(10, '0');
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function readErrorDescription(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const error = (payload as { error?: { description?: unknown } }).error;
  return typeof error?.description === 'string' ? error.description : undefined;
}

/**
 * Narrows a verified webhook body into our own event shape.
 *
 * A signed body is trusted for AUTHORSHIP, never for SHAPE — this is still parsing input from the
 * network. Every field is checked, and an unrecognised event returns `null` rather than throwing,
 * because Razorpay sends events we did not subscribe to and the endpoint must answer 200 to all of
 * them or they are redelivered forever.
 *
 * `gatewayRef` is the ORDER id, because that is what we stored when the intent was created and
 * therefore what a webhook has to be matched back to. The payment's own id travels separately.
 */
function toGatewayEvent(body: unknown, eventId: string | undefined): GatewayEvent | null {
  if (typeof body !== 'object' || body === null) return null;

  const event = (body as { event?: unknown }).event;
  if (typeof event !== 'string') return null;

  if (event === 'qr_code.credited' || event === 'qr_code.closed') return toQrEvent(body, event, eventId);

  const type = EVENT_TYPES[event];
  if (type === undefined) return null;

  const entity =
    event === 'refund.processed'
      ? readEntity(body, 'refund')
      : readEntity(body, 'payment');
  if (entity === null) return null;

  const orderId = entity['order_id'];
  const paymentId = entity['id'];
  const amount = entity['amount'];

  if (typeof orderId !== 'string') return null;
  if (typeof amount !== 'number' || !Number.isInteger(amount)) return null;

  return {
    /*
     * The header, which Razorpay documents as unique per event. Falling back to the event name
     * plus the entity id keeps dedup working if a provider ever omits it — repeated deliveries of
     * one event still collapse, which is the property that matters.
     */
    eventId: eventId ?? `${event}:${String(paymentId)}`,
    type,
    gatewayRef: orderId,
    ...(typeof paymentId === 'string' ? { providerPaymentId: paymentId } : {}),
    amountPaise: amount,
    ...(typeof entity['error_description'] === 'string'
      ? { failureReason: customerSafeFailure(entity['error_description']) }
      : {}),
  };
}

/**
 * A QR event. `gatewayRef` is the QR's OWN id — what we stored when we made it — because a payment
 * made on a QR has no order. A credit carries the payment it brought; a close carries only the QR.
 *
 * THE PROVIDER'S CLOSE OF A QR THAT WAS PAID IS NOT AN EVENT FOR US. A single-use QR closes itself
 * the moment it is paid, and that arrives beside (and sometimes before) the credit — reporting it
 * would mark a paid trip's QR as expired. Only a close that was NOT a payment is reported.
 */
function toQrEvent(
  body: unknown,
  event: 'qr_code.credited' | 'qr_code.closed',
  eventId: string | undefined,
): GatewayEvent | null {
  const qr = readEntity(body, 'qr_code');
  const qrId = qr?.['id'];
  if (qr === null || typeof qrId !== 'string') return null;

  if (event === 'qr_code.closed') {
    if (qr['close_reason'] === 'paid') return null;
    return { eventId: eventId ?? `${event}:${qrId}`, type: 'QR_CLOSED', gatewayRef: qrId, amountPaise: 0 };
  }

  const payment = readEntity(body, 'payment');
  const paymentId = payment?.['id'];
  const amount = payment?.['amount'];
  if (payment === null || typeof paymentId !== 'string') return null;
  if (typeof amount !== 'number' || !Number.isInteger(amount)) return null;

  return {
    eventId: eventId ?? `${event}:${qrId}:${paymentId}`,
    type: 'PAYMENT_CAPTURED',
    gatewayRef: qrId,
    providerPaymentId: paymentId,
    amountPaise: amount,
  };
}

const EVENT_TYPES: Record<string, GatewayEvent['type']> = {
  'payment.authorized': 'PAYMENT_AUTHORIZED',
  'payment.captured': 'PAYMENT_CAPTURED',
  'payment.failed': 'PAYMENT_FAILED',
  'refund.processed': 'REFUND_COMPLETED',
};

function readEntity(body: unknown, key: string): Record<string, unknown> | null {
  const payload = (body as { payload?: Record<string, unknown> }).payload;
  if (typeof payload !== 'object' || payload === null) return null;

  const wrapper = payload[key];
  if (typeof wrapper !== 'object' || wrapper === null) return null;

  const entity = (wrapper as { entity?: unknown }).entity;
  return typeof entity === 'object' && entity !== null ? (entity as Record<string, unknown>) : null;
}

/**
 * Razorpay's decline text is written for a developer. This is rendered to a customer, so anything
 * we have not deliberately worded is replaced rather than passed through.
 */
function customerSafeFailure(description: string): string {
  const safe = /^[\w\s.,'()-]{1,140}$/.test(description);
  return safe ? description : 'The payment could not be completed. Please try again.';
}
