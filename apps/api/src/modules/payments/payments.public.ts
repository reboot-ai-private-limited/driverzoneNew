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
}

export type PaymentsPublicContract = PaymentsContract;

export type { Payment, PaymentKind, PaymentStatus } from './domain/payment.entity.js';
export { isCaptured, PAYMENT_KINDS, PAYMENT_STATUSES } from './domain/payment.entity.js';
