import type {
  LogoutRequest,
  LogoutResponse,
  OtpSendRequest,
  OtpSendResponse,
  OtpVerifyRequest,
  OtpVerifyResponse,
  RefreshRequest,
  RefreshResponse,
} from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { request } from '../client';

/**
 * `/driver/auth/*` — apps/api/src/modules/identity/interface/auth.routes.ts, mounted per role.
 *
 * One file per API module, mirroring `apps/api/src/modules/` one-for-one, same rule as the
 * panel's and the customer app's `lib/api/endpoints/`.
 */
const AUTH = `${ROLE_PREFIX}/auth`;

/**
 * The response is identical for a registered and an unregistered number, by design — a reply
 * that differed would be an account-enumeration oracle (docs/LLD/auth.md). So there is nothing
 * to branch on here, and the phone screen always advances to the OTP screen.
 */
export function sendOtp(body: OtpSendRequest): Promise<OtpSendResponse> {
  return request<OtpSendResponse>(`${AUTH}/otp/send`, { method: 'POST', body });
}

export function verifyOtp(body: OtpVerifyRequest): Promise<OtpVerifyResponse> {
  return request<OtpVerifyResponse>(`${AUTH}/otp/verify`, { method: 'POST', body });
}

/**
 * `skipAuthRefresh` is not optional here — it is what stops the client's 401 recovery from
 * recursing into the very call that just failed. A rejected refresh answers 401
 * `REFRESH_TOKEN_INVALID`, which the client would otherwise treat as "expired, go and refresh",
 * and since renewal is single-flight the retry would await the promise it was spawned from and
 * never settle.
 */
export function refresh(body: RefreshRequest): Promise<RefreshResponse> {
  return request<RefreshResponse>(`${AUTH}/refresh`, {
    method: 'POST',
    body,
    skipAuthRefresh: true,
  });
}

/** Same reasoning: a 401 while signing out means the session is already gone, not that it needs
 *  renewing — and renewing it would be the opposite of what the caller asked for. */
export function logout(body: LogoutRequest): Promise<LogoutResponse> {
  return request<LogoutResponse>(`${AUTH}/logout`, {
    method: 'POST',
    body,
    skipAuthRefresh: true,
  });
}
