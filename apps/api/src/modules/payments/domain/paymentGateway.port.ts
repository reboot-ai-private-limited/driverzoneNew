/**
 * DOMAIN — what a payment provider has to be able to do, in the smallest shape that works.
 *
 * Deliberately three methods. Every gateway offers dozens; a port that mirrors one provider's
 * API is a port that has to be redesigned to accept a second. What the booking flow actually
 * needs is: start a charge, learn whether it succeeded, and send money back.
 *
 * The verification method is here rather than in the webhook controller because the signing
 * scheme is the provider's, not ours — Razorpay's HMAC and Stripe's timestamped scheme differ,
 * and a controller that knows which one is in use is a controller that has to change when the
 * provider does.
 */

export interface PaymentIntent {
  /** The gateway's id, stored on our payment row for reconciliation. */
  gatewayRef: string;
  /**
   * What the client needs to hand to the provider's SDK to actually collect. Opaque to us: an
   * order id for Razorpay, a client secret for Stripe. Passed through to the app untouched.
   */
  clientToken: string;
  /** True when the provider settled it synchronously and no webhook is coming. */
  capturedImmediately: boolean;
}

export interface RefundResult {
  gatewayRef: string;
  amountPaise: number;
}

/** A webhook that verified. `eventId` is what makes replaying it harmless. */
export interface GatewayEvent {
  /** The provider's own event id. Deduplicated on, so a redelivered webhook does nothing twice. */
  eventId: string;
  type: 'PAYMENT_CAPTURED' | 'PAYMENT_FAILED' | 'REFUND_COMPLETED';
  gatewayRef: string;
  amountPaise: number;
  /** Customer-safe decline reason, when the provider gives one. */
  failureReason?: string | undefined;
}

export interface PaymentGatewayPort {
  createIntent(input: {
    amountPaise: number;
    /** Ours, passed to the provider so their dashboard reconciles against our records. */
    reference: string;
    idempotencyKey: string;
  }): Promise<PaymentIntent>;

  refund(input: { gatewayRef: string; amountPaise: number; idempotencyKey: string }): Promise<RefundResult>;

  /**
   * Verifies a raw webhook body and signature, returning the event or `null` if it does not
   * verify. Returns rather than throws: an unverified webhook is not an exception, it is a
   * request from someone who is not the payment provider, and the caller answers it with a 401.
   */
  verifyWebhook(rawBody: string, signature: string): GatewayEvent | null;
}
