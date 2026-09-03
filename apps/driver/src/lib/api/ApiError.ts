import type { FaultCode, HttpErrorBody } from '@driverzone/contracts';

/**
 * A failed API response, as an Error. Identical to the customer app's — same envelope, same two
 * fields with very different jobs:
 *
 *   `message` — the SERVER'S wording, rendered verbatim and never rewritten. A reason added
 *               server-side then renders correctly on a client that predates it, which matters
 *               more here than anywhere: the installed version is a Play Store binary nobody
 *               can recall (docs/engineering/frontend-architecture.md).
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

  /**
   * The `missing` list off a 400 from `POST /driver/onboarding/submit` — dot-paths like
   * `dob` and `documents.AADHAAR`, produced by `missingForSubmission` on the server
   * (apps/api/.../driverOnboarding.entity.ts).
   *
   * Reading it here rather than at the call site is what lets the onboarding screens deep-link
   * to the exact field instead of showing "complete your profile", which sends a driver hunting
   * through every screen. Drivers abandoning onboarding is a supply problem, not just a UX one.
   */
  get missingFields(): string[] {
    const data = this.data;
    if (typeof data !== 'object' || data === null) return [];
    const value = (data as Record<string, unknown>)['missing'];
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
}

/**
 * Not an API response at all — no signal, airplane mode, the dev API not running, DNS failed.
 * There is no envelope and therefore no request id. Far more common on a phone than in a
 * browser, so it is a distinct type rather than a special-cased `ApiError`.
 */
export class NetworkError extends Error {
  /**
   * The underlying transport failure, when there was one.
   *
   * Kept because "Network request failed", a TLS handshake error and a DNS failure are different
   * problems with different fixes, and collapsing all of them into one reassuring sentence is how
   * a genuine fault gets misread as bad signal. Appended to the message rather than hidden on the
   * instance: on a driver's handset there is no console to inspect it in.
   *
   * Named `transportError` rather than `cause` on purpose: `Error.cause` is a standard ES2022
   * property typed `unknown`, and redeclaring it as `string` narrows a member of the base class.
   */
  readonly transportError: string | undefined;

  constructor(transportError?: string | undefined) {
    super(
      transportError === undefined
        ? 'Could not reach DriverZone. Check your connection and try again.'
        : `Could not reach DriverZone. Check your connection and try again. (${transportError})`,
    );
    this.name = 'NetworkError';
    this.transportError = transportError;
  }
}
