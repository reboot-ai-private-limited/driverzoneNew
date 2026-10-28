import type { Payment, PaymentKind } from './domain/payment.entity.js';

/**
 * PUBLIC CONTRACT — the only surface other modules may import from `payments`.
 *
 * `bookings` is the consumer. It asks for a charge when a quote is confirmed, asks for another
 * when a trip completes with extras to settle, and asks for a refund when a booking is cancelled.
 * It never learns which provider is behind any of it.
 *
 * NOTE THE DIRECTION OF THE PAYMENT-SETTLED NOTIFICATION. `payments` sits at tier 2 and
 * `bookings` at tier 6, so this module cannot call it back — the webhook controller is handed a
 * callback by the composition root instead. A tempting `paymentsContract.onCaptured(handler)`
 * here would be the same coupling wearing a different hat.
 */
export interface PaymentsContract {
  /**
   * Makes a single-use UPI QR the DRIVER shows for a trip, stored as a pending payment on that
   * trip. Idempotent on `idempotencyKey`: calling twice returns the same payment and never makes a
   * second live QR. `metadata` is remembered with the charge and handed back on `listForBooking` —
   * the caller's own breakdown of what the one payment covers.
   */
  chargeByQr(input: {
    bookingId: string;
    customerId: string;
    kind: PaymentKind;
    amountPaise: number;
    reference: string;
    idempotencyKey: string;
    expiresAt: Date;
    metadata: Record<string, number>;
  }): Promise<Payment>;

  /** Stops a QR taking payments (expired, replaced, or the trip was paid another way). */
  closeQr(paymentId: string, reason: string): Promise<void>;

  /**
   * Asks the gateway whether a QR has been paid and expires one that ran out of time. `justCaptured`
   * is true only when THIS call made the capture — the flag to hang a once-only side effect off,
   * exactly like `verifyAndCapture`'s. Null when the payment is not a QR.
   */
  refreshQr(paymentId: string): Promise<{ payment: Payment; justCaptured: boolean } | null>;

  /**
   * Starts a charge, idempotently on `idempotencyKey`. Calling twice with one key returns the
   * same payment and never charges twice.
   *
   * `clientToken` is what the app hands to the provider's SDK, and is null when the payment was
   * already settled — which is what a retry of an auto-captured charge looks like.
   */
  charge(input: {
    bookingId: string;
    customerId: string;
    kind: PaymentKind;
    amountPaise: number;
    reference: string;
    idempotencyKey: string;
  }): Promise<{ payment: Payment; clientToken: string | null; publicKey: string | null }>;

  /** Sends money back. Omit `amountPaise` to refund everything still refundable. */
  refund(input: {
    paymentId: string;
    amountPaise?: number | undefined;
    idempotencyKey: string;
  }): Promise<Payment>;

  findById(paymentId: string): Promise<Payment | null>;
  listForBooking(bookingId: string): Promise<Payment[]>;

  /**
   * Verifies a checkout SDK's success callback and captures the payment immediately if it holds
   * up — the accelerant to the webhook, never a replacement for it. `false` covers an unverified
   * signature and an unknown payment alike; the caller's answer to both is "keep waiting for the
   * webhook", not an error.
   *
   * `justCaptured` is true only when THIS call made the transition, and is the flag to hang a
   * once-only side effect off. `captured` is true for an already-settled row too, so a caller that
   * credits money on `captured` credits it twice — once here and once when the webhook lands.
   */
  verifyAndCapture(input: {
    paymentId: string;
    providerPaymentId: string;
    signature: string;
  }): Promise<{ captured: boolean; justCaptured: boolean }>;

  /**
   * The checkout publishable key, static for the whole app — not per-charge. Exposed so a caller
   * can resume a checkout (e.g. re-showing it for an order that already exists, on an idempotent
   * retry) without calling `charge` again just to get this back. `null` under the mock gateway,
   * same as `charge`'s own `publicKey` is on that path.
   */
  readonly publicKey: string | null;
}

export type PaymentsPublicContract = PaymentsContract;

export type { Payment, PaymentKind, PaymentStatus } from './domain/payment.entity.js';
export { isCaptured, PAYMENT_KINDS, PAYMENT_STATUSES } from './domain/payment.entity.js';
