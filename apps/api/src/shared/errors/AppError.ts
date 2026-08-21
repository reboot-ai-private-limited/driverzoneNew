import type { FaultCode } from '@driverzone/contracts';

/**
 * An error with an HTTP status and a customer-safe message.
 *
 * `message` is displayed to whoever made the request, so it must never carry a cause, a query,
 * or an internal identifier. Diagnostics go in `details`, which the error handler logs and
 * strips from production responses.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: FaultCode;
  readonly details?: unknown;
  /** False for genuine faults — used to decide what pages someone. */
  readonly isExpected: boolean;

  constructor(opts: {
    statusCode: number;
    code: FaultCode;
    message: string;
    details?: unknown;
    isExpected?: boolean;
  }) {
    super(opts.message);
    this.name = 'AppError';
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.details = opts.details;
    this.isExpected = opts.isExpected ?? true;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError({ statusCode: 400, code: 'VALIDATION_FAILED', message, details });
  }

  static unauthenticated(message = 'Please sign in to continue.'): AppError {
    return new AppError({ statusCode: 401, code: 'UNAUTHENTICATED', message });
  }

  static forbidden(message = 'You do not have access to this.'): AppError {
    return new AppError({ statusCode: 403, code: 'FORBIDDEN', message });
  }

  static notFound(message = 'Not found.'): AppError {
    return new AppError({ statusCode: 404, code: 'NOT_FOUND', message });
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError({ statusCode: 409, code: 'CONFLICT', message, details });
  }

  /**
   * A fault that should be impossible — a violated invariant rather than bad input.
   *
   * `isExpected: false` is what routes it to an alert. The customer-facing message is
   * deliberately generic: a configuration fault is never the customer's problem to understand
   * (docs/04-zone-resolution.md §Error codes).
   */
  static internal(code: FaultCode, details?: unknown): AppError {
    return new AppError({
      statusCode: 500,
      code,
      message: 'Something went wrong. Please try again shortly.',
      details,
      isExpected: false,
    });
  }
}
