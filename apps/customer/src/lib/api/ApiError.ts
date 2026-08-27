import type { FaultCode, HttpErrorBody } from '@driverzone/contracts';

/**
 * A failed API response, as an Error. The mobile counterpart of apps/web's `ApiError` — same
 * envelope, same two fields with very different jobs:
 *
 *   `message` — the SERVER'S wording, rendered verbatim and never rewritten. A reason added
 *               server-side then renders correctly on a client that predates it, which matters
 *               far more here than on the web: the old version is a store binary nobody can
 *               recall (docs/engineering/frontend-architecture.md).
 *   `code`    — control flow ONLY. Which state to show, whether to offer a retry.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: FaultCode;
  readonly requestId: string;
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

  get isRetryable(): boolean {
    return this.status >= 500;
  }

  /**
   * `retry_after_seconds` off a 429 or an OTP cooldown. The OTP screen's resend countdown is
   * driven by this and never by a hardcoded number — the server owns the cooldown.
   */
  get retryAfterSeconds(): number | undefined {
    const data = this.data;
    if (typeof data !== 'object' || data === null) return undefined;
    const value = (data as Record<string, unknown>)['retry_after_seconds'];
    return typeof value === 'number' ? value : undefined;
  }
}

/**
 * Not an API response at all — no signal, airplane mode, the dev API not running, DNS failed.
 * There is no envelope and therefore no request id. Far more common on a phone than in a
 * browser, so it is a distinct type rather than a special-cased `ApiError`.
 */
export class NetworkError extends Error {
  constructor() {
    super('Could not reach DriverZone. Check your connection and try again.');
    this.name = 'NetworkError';
  }
}
