import { AppError } from '@/shared/errors/AppError.js';

/**
 * DOMAIN — the failures this module is allowed to express.
 *
 * They are factories rather than subclasses because `AppError` already carries everything that
 * varies (status, code, the two detail channels, the expected/fault split) and a subclass per
 * code would add six files that hold no behaviour.
 *
 * The overriding rule here: **a caller learns nothing it did not already know.** Every message
 * below is deliberately vague, and the vagueness is the security property, not sloppiness.
 */

/**
 * The single answer to wrong code, expired challenge, no challenge at all, and — for admin — a
 * number that was never provisioned.
 *
 * Splitting these into distinct codes would be friendlier and would also be an oracle: "no
 * challenge" versus "wrong code" tells an attacker whether a number is registered, and for
 * `/admin/auth` it tells them which numbers belong to staff. One code, one message, always.
 */
export function otpInvalidOrExpired(): AppError {
  return new AppError({
    statusCode: 401,
    code: 'OTP_INVALID_OR_EXPIRED',
    message: 'That code is incorrect or has expired.',
  });
}

/**
 * The challenge is burnt after too many wrong guesses; the next step is a new code, not another
 * attempt. `retry_after_seconds: 0` says exactly that — resend is available immediately,
 * subject only to the send cooldown.
 */
export function otpAttemptsExceeded(): AppError {
  return new AppError({
    statusCode: 429,
    code: 'OTP_ATTEMPTS_EXCEEDED',
    message: 'Too many incorrect attempts. Request a new code.',
    publicDetails: { retry_after_seconds: 0 },
  });
}

/** A resend inside the cooldown. `publicDetails` so the client can render a live countdown. */
export function otpCooldownActive(retryAfterSeconds: number): AppError {
  return new AppError({
    statusCode: 429,
    code: 'OTP_COOLDOWN_ACTIVE',
    message: 'Please wait before requesting another code.',
    publicDetails: { retry_after_seconds: retryAfterSeconds },
  });
}

/** The hourly cap, per phone or per IP. */
export function otpSendLimitExceeded(retryAfterSeconds: number): AppError {
  return new AppError({
    statusCode: 429,
    code: 'OTP_SEND_LIMIT_EXCEEDED',
    message: 'Too many code requests. Please try again later.',
    publicDetails: { retry_after_seconds: retryAfterSeconds },
  });
}

/** Malformed, expired, or a signature that does not verify. */
export function refreshTokenInvalid(): AppError {
  return new AppError({
    statusCode: 401,
    code: 'REFRESH_TOKEN_INVALID',
    message: 'Your session has ended. Please sign in again.',
  });
}

/**
 * The session family was revoked — in practice, an already-used refresh token was replayed
 * outside the double-submit grace window.
 *
 * `isExpected: false`, which is what routes this to the error log and an alert
 * (`shared/http/error-handler.ts`). This is the one failure in this file that might be an attack
 * in progress rather than ordinary traffic, and it must not be filed alongside typo'd OTPs.
 */
export function sessionRevoked(details?: unknown): AppError {
  return new AppError({
    statusCode: 401,
    code: 'SESSION_REVOKED',
    message: 'Your session has ended. Please sign in again.',
    details,
    isExpected: false,
  });
}
