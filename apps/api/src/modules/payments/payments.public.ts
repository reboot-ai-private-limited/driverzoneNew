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
