import type { Payment, PaymentKind, PaymentStatus } from './payment.entity.js';

export interface CreatePaymentData {
  bookingId: string;
  customerId: string;
  kind: PaymentKind;
  amountPaise: number;
  idempotencyKey: string;
}

export interface PaymentRepositoryPort {
  create(data: CreatePaymentData): Promise<Payment>;

  findById(id: string): Promise<Payment | null>;
  findByIdempotencyKey(key: string): Promise<Payment | null>;
  findByGatewayRef(gatewayRef: string): Promise<Payment | null>;
  listForBooking(bookingId: string): Promise<Payment[]>;

  /**
   * Moves a payment's status, but ONLY from the status the caller believed it was in.
   *
   * A compare-and-swap rather than a plain update, because a gateway webhook and an API poll can
   * resolve the same payment at the same instant. Returns `null` when the row was not in `from`,
   * which the caller reads as "somebody else already settled this" — not as an error.
   */
  transition(
    id: string,
    from: PaymentStatus,
    to: PaymentStatus,
    patch?: { gatewayRef?: string; failureReason?: string; refundedPaise?: number },
  ): Promise<Payment | null>;

  attachGatewayRef(id: string, gatewayRef: string): Promise<Payment | null>;

  /**
   * Records that a gateway event id has been handled, returning false if it already had been.
   *
   * The whole of webhook idempotency lives in this one call. Providers redeliver aggressively —
   * a capture arriving three times is normal — and a booking must not be confirmed, or a driver
   * paid, once per delivery.
   */
  markEventProcessed(eventId: string): Promise<boolean>;
}
