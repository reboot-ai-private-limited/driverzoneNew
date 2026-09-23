import type { CookieOptions, RequestHandler, Response } from 'express';
import type {
  LogoutResponse,
  OtpSendResponse,
  OtpVerifyResponse,
  RefreshResponse,
  Role,
} from '@driverzone/contracts';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import { isProduction } from '@/config/env.js';
import { REFRESH_TOKEN_TTL_SECONDS } from '@/shared/security/jwt.js';
import { refreshTokenInvalid } from '../domain/identity.errors.js';
import { logoutSchema, otpSendSchema, otpVerifySchema, refreshSchema } from './identity.validation.js';
import type { LogoutUseCase } from '../application/useCases/logout.usecase.js';
import type { RefreshSessionUseCase } from '../application/useCases/refreshSession.usecase.js';
import type { SendOtpUseCase } from '../application/useCases/sendOtp.usecase.js';
import type { VerifyOtpUseCase } from '../application/useCases/verifyOtp.usecase.js';

/**
 * INTERFACE — HTTP in, use-case call, HTTP out. No rules of its own.
 *
 * Every handler is built per ROLE. The role is not read from the request — it comes from which
 * router this controller was mounted under, so there is no body field or header a caller could
 * set to ask for a different one.
 */

export const REFRESH_COOKIE_NAME = 'dz_refresh';

/** Where the admin refresh cookie is scoped. Narrow on purpose — see `refreshCookieOptions`. */
export const ADMIN_AUTH_COOKIE_PATH = '/api/admin/auth';

/**
 * Only admin uses a cookie. Customer and driver are mobile apps, which cannot read an httpOnly
 * cookie and store the refresh token in the OS keystore instead
 * (docs/decision-log.md, 2026-08-24).
 */
function usesCookie(role: Role): boolean {
  return role === 'ADMIN';
}

/**
 * Everything except `maxAge`.
 *
 * Split out because a cookie is only cleared by a response whose path and flags MATCH the ones
 * it was set with — a `clearCookie` missing `path` silently leaves the cookie in place, and the
 * admin stays logged in after asking not to be. Sharing one definition is what stops the two
 * call sites drifting.
 */
function refreshCookieAttributes(): Omit<CookieOptions, 'maxAge'> {
  return {
    // No JavaScript access: an XSS on the admin panel still cannot read the refresh token.
    httpOnly: true,
    // HTTPS only — but not in development, where the dev server is plain http and a Secure
    // cookie would simply never be stored, breaking local login with no visible reason.
    secure: isProduction,
    // Strict, not Lax: nothing about the admin panel involves following a link from another
    // site into an authenticated action, so the looser mode buys nothing and costs CSRF safety.
    sameSite: 'strict',
    // Scoped to the auth routes only, so the cookie is not attached to every admin API call —
    // a token that rides along on hundreds of unrelated requests has hundreds of chances to leak.
    path: ADMIN_AUTH_COOKIE_PATH,
  };
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...refreshCookieAttributes(),
    maxAge: REFRESH_TOKEN_TTL_SECONDS.ADMIN * 1000,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieAttributes());
}

export interface AuthControllerDeps {
  sendOtp: SendOtpUseCase;
  verifyOtp: VerifyOtpUseCase;
  refreshSession: RefreshSessionUseCase;
  logout: LogoutUseCase;
}

export interface AuthControllers {
  sendOtp: RequestHandler;
  verifyOtp: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
}

export function makeAuthControllers(role: Role, deps: AuthControllerDeps): AuthControllers {
  return {
    sendOtp: asyncHandler(async (req, res) => {
      const input = otpSendSchema.parse(req.body);

      const result = await deps.sendOtp.execute({
        role,
        phone: input.mobile_number,
        ip: req.ip,
        channel: input.channel,
      });

      const body: OtpSendResponse = {
        sent: true,
        expires_in_seconds: result.expiresInSeconds,
        retry_after_seconds: result.retryAfterSeconds,
      };
      sendSuccess(req, res, body, 'Code sent');
    }),

    verifyOtp: asyncHandler(async (req, res) => {
      const input = otpVerifySchema.parse(req.body);

      const result = await deps.verifyOtp.execute({
        role,
        phone: input.mobile_number,
        code: input.otp,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      if (usesCookie(role)) setRefreshCookie(res, result.refreshToken);

      const body: OtpVerifyResponse = {
        // Both omitted rather than set for admin: `exactOptionalPropertyTypes` makes
        // `{ x: undefined }` and `{}` different types, and the latter is what serialises cleanly.
        ...(usesCookie(role) ? {} : { is_new_user: result.isNewUser, refresh_token: result.refreshToken }),
        access_token: result.accessToken,
        user: {
          id: result.account.id,
          mobile_number: result.account.mobileNumber,
          full_name: result.account.fullName,
        },
      };
      sendSuccess(req, res, body, 'Signed in');
    }),

    refresh: asyncHandler(async (req, res) => {
      const input = refreshSchema.parse(req.body ?? {});

      // Admin's token is read from its cookie and never from the body; the other two are the
      // reverse. Taking whichever is present would let an admin bypass the httpOnly cookie by
      // posting a token in JSON, which is the property the cookie exists to provide.
      const token = usesCookie(role)
        ? (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME]
        : input.refresh_token;

      if (token === undefined || token === '') throw refreshTokenInvalid();

      const result = await deps.refreshSession.execute({
        role,
        token,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      if (usesCookie(role)) setRefreshCookie(res, result.refreshToken);

      const body: RefreshResponse = {
        access_token: result.accessToken,
        ...(usesCookie(role) ? {} : { refresh_token: result.refreshToken }),
      };
      sendSuccess(req, res, body, 'Session refreshed');
    }),

    logout: asyncHandler(async (req, res) => {
      const input = logoutSchema.parse(req.body ?? {});

      const token = usesCookie(role)
        ? (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME]
        : input.refresh_token;

      await deps.logout.execute({ role, token });

      // Cleared unconditionally, even when nothing was revoked. A client asking to log out ends
      // up logged out, whatever state its token was in.
      if (usesCookie(role)) clearRefreshCookie(res);

      const body: LogoutResponse = { logged_out: true };
      sendSuccess(req, res, body, 'Signed out');
    }),
  };
}
