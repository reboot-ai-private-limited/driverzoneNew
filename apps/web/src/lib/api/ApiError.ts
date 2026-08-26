import type { FaultCode, HttpErrorBody } from '@driverzone/contracts';

/**
 * A failed API response, as an Error.
 *
 * Two fields with very different jobs, and confusing them is the most common way a client
 * misbehaves (docs/engineering/coding-standards.md §Frontend):
 *
 *   `message` — the SERVER'S wording. Rendered verbatim, never rewritten. It is guaranteed
 *               safe to display, and a reason added server-side then renders correctly on a
 *               client that predates it.
 *   `code`    — control flow ONLY. Which state to show, whether to offer a retry, whether to
 *               redirect. Never a source of copy.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: FaultCode;
  readonly requestId: string;
  /** What the CALLER needs to act — field-level validation errors, `retry_after_seconds`. */
  readonly data: unknown;

  constructor(body: HttpErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = body.statusCode;
    this.code = body.code as FaultCode;
    this.requestId = body.request.requestId;
    this.data = body.data;
  }

  /** A 401 the session layer can attempt to recover from by refreshing. */
  get isAuthExpiry(): boolean {
    return this.status === 401 && this.code !== 'SESSION_REVOKED';
  }

  /**
   * Retrying a 4xx produces the same failure more slowly. The one exception is 429, where the
   * server has told us when to come back — but that is a countdown the UI owns, not a retry
   * the query layer should perform on its own.
   */
  get isRetryable(): boolean {
    return this.status >= 500;
  }

  /** `retry_after_seconds` off a 429 body, when the server sent one. */
  get retryAfterSeconds(): number | undefined {
    const data = this.data;
    if (typeof data !== 'object' || data === null) return undefined;
    const value = (data as Record<string, unknown>)['retry_after_seconds'];
    return typeof value === 'number' ? value : undefined;
  }
}

/**
 * Something that is not an API response at all — the network is down, the API is not running,
 * DNS failed. There is no envelope and therefore no request id.
 */
export class NetworkError extends Error {
  constructor() {
    super('Could not reach the server. Check your connection and try again.');
    this.name = 'NetworkError';
  }
}
