/**
 * Auth and user wire types (docs/LLD/13-auth-and-user.md).
 *
 * Types only, like everything else in this package — the API validates these shapes with Zod in
 * `identity/interface/identity.validation.ts`, and a compile-only assertion there checks the
 * inferred shape against the request types below in BOTH directions. That check is why a field
 * added to one side and not the other is a build failure rather than a runtime surprise in a
 * shipped store binary.
 */

export const ROLES = ['CUSTOMER', 'DRIVER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** The claims an access token carries. `aud` equals the role — that IS the audience check. */
export interface AuthPrincipal {
  /** The account id this token was issued for. */
  sub: string;
  role: Role;
}

// ─── OTP ────────────────────────────────────────────────────────────────────────────────────

export interface OtpSendRequest {
  mobile_number: string;
}

/**
 * Identical for every role and every number, registered or not.
 *
 * Deliberate: a response that differs for a known number is how an attacker enumerates which
 * numbers have accounts — and, for `/admin/auth`, which numbers belong to staff.
 */
export interface OtpSendResponse {
  sent: true;
  expires_in_seconds: number;
  /** Seconds until another send is allowed. Lets a client render a countdown, not a dead wall. */
  retry_after_seconds: number;
}

export interface OtpVerifyRequest {
  mobile_number: string;
  otp: string;
}

export interface AuthUserDto {
  id: string;
  mobile_number: string;
  /** Null until the customer or driver fills it in — profiles complete progressively. */
  full_name: string | null;
}

export interface OtpVerifyResponse {
  /**
   * True on the first-ever verify for a number, when the account was created by this call.
   * Absent for `ADMIN`, whose accounts are never created by the auth flow.
   */
  is_new_user?: boolean;
  access_token: string;
  /** Omitted for `ADMIN` — the refresh token is set as an httpOnly cookie instead. */
  refresh_token?: string;
  user: AuthUserDto;
}

// ─── Session ────────────────────────────────────────────────────────────────────────────────

/**
 * Customer/driver send the token in the body; admin's is read from its cookie, so admin posts
 * no body at all.
 *
 * The explicit `| undefined` is not noise. `apps/api` compiles with
 * `exactOptionalPropertyTypes`, under which `?: string` and `?: string | undefined` are
 * different types — the first forbids `{ refresh_token: undefined }`, the second permits it.
 * Zod's `.optional()` produces the permissive one, and the compile-time drift guard in
 * `identity/interface/identity.typecheck.ts` compares the two exactly. Writing `?: string` here
 * fails the build rather than silently disagreeing with what the server actually accepts.
 */
export interface RefreshRequest {
  refresh_token?: string | undefined;
}

export interface RefreshResponse {
  access_token: string;
  /** Omitted for `ADMIN` — rotated into the cookie instead. */
  refresh_token?: string;
}

/** Same shape and same `| undefined` reasoning as `RefreshRequest`. */
export interface LogoutRequest {
  refresh_token?: string | undefined;
}

/** Always `true`, on every outcome. Logging out twice is not an error worth showing anyone. */
export interface LogoutResponse {
  logged_out: true;
}
