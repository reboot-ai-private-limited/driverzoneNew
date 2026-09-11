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
  /**
   * The PUBLISHABLE key the SDK needs beside the token — `rzp_test_…` for Razorpay, a publishable
   * key for Stripe. Safe to send to a device by design; the secret half never leaves the server.
   *
   * Null for a gateway that does not have the pair.
   */
  publicKey: string | null;
  /** True when the provider settled it synchronously and no webhook is coming. */
  capturedImmediately: boolean;
}

/**
 * A webhook as it arrived. A struct rather than two strings because the field that makes
 * redelivery safe is a HEADER, not part of the body: Razorpay's `x-razorpay-event-id` is unique
 * per event, and the body carries only the event NAME.
 */
export interface WebhookRequest {
  /** The exact bytes as received. Reserialising a parsed body will not reproduce the signature. */
  rawBody: string;
  signature: string;
  /** The provider's unique delivery id, from whichever header carries it. */
  eventId: string | undefined;
}

export interface RefundResult {
  gatewayRef: string;
  amountPaise: number;
}

/** A webhook that verified. `eventId` is what makes replaying it harmless. */
export interface GatewayEvent {
  /** The provider's own event id. Deduplicated on, so a redelivered webhook does nothing twice. */
  eventId: string;
  /**
   * `PAYMENT_AUTHORIZED` means the money is held but not taken, and something must capture it.
   * The other three are settled outcomes.
   */
  type: 'PAYMENT_AUTHORIZED' | 'PAYMENT_CAPTURED' | 'PAYMENT_FAILED' | 'REFUND_COMPLETED';
  /**
   * OUR payment's gateway reference — for Razorpay the ORDER id, which is what we stored when the
   * intent was created. A refund event carries the order of the payment being refunded, not the
   * refund's own id, so every event maps back to one row of ours.
   */
  gatewayRef: string;
  /** The provider's id for the payment itself, needed to capture or refund it. */
  providerPaymentId?: string | undefined;
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
   * Captures an authorised-but-uncaptured payment.
   *
   * Needed because auto-capture is an ACCOUNT SETTING at Razorpay, not a per-order one. With it
   * off we are sent `payment.authorized` and the money is merely held — an authorisation nobody
   * captures reverses itself after a few days, so the customer is debited, gets a ride, and is
   * silently refunded. Calling this on `authorized` is correct under either configuration.
   */
  capture(gatewayRef: string, amountPaise: number): Promise<void>;

  /**
   * Verifies a webhook, returning the event or `null` if it does not verify. Returns rather than
   * throws: an unverified webhook is not an exception, it is a request from someone who is not the
   * payment provider, and the caller answers it with a 401.
   */
  verifyWebhook(request: WebhookRequest): GatewayEvent | null;

  /**
   * Verifies the signature a checkout SDK hands back on success, so the caller can confirm a
   * payment instantly instead of waiting for `verifyWebhook`'s delivery. `orderId` must be OUR
   * stored `gatewayRef`, never a client-supplied order id — a caller who controls both halves of
   * the signed message can forge the signature too. Never the sole source of truth: a webhook
   * still confirms independently, and this exists only to let a caller stop waiting sooner.
   */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
}
