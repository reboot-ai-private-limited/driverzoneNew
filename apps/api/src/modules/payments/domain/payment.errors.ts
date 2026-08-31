import { AppError } from '../../../shared/errors/AppError.js';

export class PaymentNotFoundError extends AppError {
  constructor(id: string) {
    super({
      statusCode: 404,
      code: 'PAYMENT_NOT_FOUND',
      message: 'No such payment',
      details: { id },
      isExpected: true,
    });
  }
}

/**
 * 402, and the reason is deliberately customer-safe: it is rendered verbatim in the app. A
 * gateway's own decline text ("insufficient_funds", "do_not_honour") is not, so the adapter maps
 * it before it reaches here.
 */
export class PaymentFailedError extends AppError {
  constructor(reason: string) {
    super({
      statusCode: 402,
      code: 'PAYMENT_FAILED',
      message: reason,
      isExpected: true,
    });
  }
}

/** Refunding more than was captured, capturing something already refunded, and similar. */
export class PaymentStateError extends AppError {
  constructor(message: string, publicDetails?: unknown) {
    super({
      statusCode: 409,
      code: 'PAYMENT_STATE_INVALID',
      message,
      ...(publicDetails === undefined ? {} : { publicDetails }),
      isExpected: true,
    });
  }
}

/**
 * A webhook that did not verify.
 *
 * 401 with nothing in it. Whoever sent this is not the payment provider, and the reply should
 * tell them as little as possible about why we know that.
 */
export class WebhookSignatureError extends AppError {
  constructor() {
    super({
      statusCode: 401,
      code: 'PAYMENT_WEBHOOK_INVALID',
      message: 'Signature verification failed',
      isExpected: true,
    });
  }
}
