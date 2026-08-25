import type {
  AdminProfileDto,
  OtpSendRequest,
  OtpSendResponse,
  OtpVerifyRequest,
  OtpVerifyResponse,
  RefreshResponse,
} from '@driverzone/contracts';
import { request } from '../client';

/**
 * `/admin/auth/*` — one surface per role, and the path IS the role (apps/api/src/routes.ts).
 * These are the only endpoints the refresh cookie is scoped to.
 */
export const authApi = {
  /**
   * The response is IDENTICAL whether or not the number is provisioned — no SMS is sent for
   * an unknown one, and `otp/verify` then fails ordinarily because there is nothing to verify
   * against (docs/LLD/auth.md §Admin provisioning).
   *
   * So the UI must advance to the OTP step regardless, and must never imply the number is
   * known. Anything else turns this endpoint into a directory of who works here.
   */
  sendOtp: (body: OtpSendRequest) =>
    request<OtpSendResponse>('/admin/auth/otp/send', { method: 'POST', body }),

  verifyOtp: (body: OtpVerifyRequest) =>
    request<OtpVerifyResponse>('/admin/auth/otp/verify', { method: 'POST', body }),

  /** No body. The httpOnly cookie is what authenticates this, read server-side. */
  refresh: () => request<RefreshResponse>('/admin/auth/refresh', { method: 'POST' }),

  /** Idempotent by design — a client retrying after a dropped response must not see an error. */
  logout: () => request<{ logged_out: true }>('/admin/auth/logout', { method: 'POST' }),

  profile: (token: string) => request<AdminProfileDto>('/admin/profile', { token }),
};
