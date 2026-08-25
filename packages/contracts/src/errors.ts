/**
 * Error and unavailability codes.
 *
 * Two categories, and the split matters operationally (docs/LLD/zone-resolution.md §Error codes):
 *
 *   UNAVAILABLE — an expected answer. "We don't serve your pickup point yet" is the system
 *   working correctly. These return HTTP 200 with `available: false`, so they stay out of
 *   error dashboards and the app can render a helpful screen instead of a generic failure.
 *
 *   FAULT — something is actually broken. These return 4xx/5xx and page someone.
 */

export const UNAVAILABLE_REASONS = [
  'ZONE_NO_PICKUP_COVERAGE',
  'DROP_OUTSIDE_CITY',
  'NO_PACKAGE_AVAILABLE',
  'NO_PACKAGE_FOR_DISTANCE',
  'ROUTE_NOT_FOUND',
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export const FAULT_CODES = [
  'ZONE_CONFIG_FAULT',
  'AMBIGUOUS_ZONE_MATCH',
  'QUOTE_EXPIRED',
  'QUOTE_ALREADY_CONSUMED',
  'INVALID_COORDINATE',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
  'PACKAGE_BAND_OVERLAP',
  'PACKAGE_NOT_SELLABLE',

  // Identity (docs/LLD/auth.md). One generic code covers wrong/expired/no-challenge
  // and an unprovisioned admin number alike — telling those apart is an enumeration oracle.
  'OTP_INVALID_OR_EXPIRED',
  'OTP_ATTEMPTS_EXCEEDED',
  'OTP_COOLDOWN_ACTIVE',
  'OTP_SEND_LIMIT_EXCEEDED',
  'SESSION_REVOKED',
  'REFRESH_TOKEN_INVALID',
] as const;
export type FaultCode = (typeof FAULT_CODES)[number];

/**
 * A "we can't serve this" answer.
 *
 * `message` is always customer-safe and displayable verbatim. Clients must never build copy
 * from `reason` — that way a reason added server-side renders correctly on app versions that
 * predate it, which matters when the old version is a store binary you cannot recall.
 */
export interface UnavailableResult {
  available: false;
  reason: UnavailableReason;
  message: string;
  suggestion?: {
    service_type: 'INCITY' | 'OUTSTATION';
    pickup: { lat: number; lng: number };
    drop?: { lat: number; lng: number };
  };
}
