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
  /** From resolves to a PICKUP zone but not the CITY zone — incity is not offered, outstation is. */
  'PICKUP_OUTSIDE_CITY',
  'DROP_OUTSIDE_CITY',
  'NO_PACKAGE_AVAILABLE',
  'NO_PACKAGE_FOR_DISTANCE',
  'ROUTE_NOT_FOUND',
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export const FAULT_CODES = [
  // Zones (docs/LLD/zones.md §Codes). ZONE_CONFIG_FAULT is now narrow — there is no
  // pickup/city parent link left to disagree, so it fires only on a resolution that is
  // internally inconsistent in a way the write path should have prevented.
  'ZONE_CONFIG_FAULT',
  'ZONE_VALIDATION_FAILED',
  'ZONE_CODE_TAKEN',
  'ZONE_ALREADY_SUPERSEDED',
  /** Hard delete refused — the zone must be deactivated first. See `deleteZone.usecase.ts`. */
  'ZONE_STILL_ACTIVE',
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

  // Packages (docs/LLD/packages.md §Codes). Both are admin-write faults, not customer traffic —
  // "no package for this trip" is a 200 with `available: false` and lives in UNAVAILABLE_REASONS.
  /** `data` carries the conflicting package id, so the editor can link straight to it. 409. */
  'PACKAGE_BAND_OVERLAP',
  /** P-3 — activating a package with no active price row. 422. */
  'PACKAGE_NOT_SELLABLE',

  // Global settings (docs/LLD/database-schema.md §globalSettings). All three are admin-write
  // faults — the read paths cannot fail this way, since an absent row simply means "default".
  /** A key that is not in `SETTING_REGISTRY`. 400 — never stored as an orphan row. */
  'SETTING_UNKNOWN_KEY',
  /** The value failed its own registry schema (a fraction of a rupee, a negative fee). 400. */
  'SETTING_VALUE_INVALID',
  /** Individually valid, jointly incoherent — overlapping windows, a ladder that steps down. 422. */
  'SETTING_INVARIANT_VIOLATED',

  // Identity (docs/LLD/auth.md). One generic code covers wrong/expired/no-challenge
  // and an unprovisioned admin number alike — telling those apart is an enumeration oracle.
  'OTP_INVALID_OR_EXPIRED',
  'OTP_ATTEMPTS_EXCEEDED',
  'OTP_COOLDOWN_ACTIVE',
  'OTP_SEND_LIMIT_EXCEEDED',
  'SESSION_REVOKED',
  'REFRESH_TOKEN_INVALID',

  // Payments (docs/LLD/pricing-and-commission.md). A booking is confirmed only once its payment
  // is captured, so these are on the path between a quote and a driver being looked for.
  'PAYMENT_NOT_FOUND',
  /** The booking cannot advance because its payment has not been captured. 402. */
  'PAYMENT_REQUIRED',
  /** The gateway declined. Carries a customer-safe reason in `publicDetails`. 402. */
  'PAYMENT_FAILED',
  /** A webhook whose signature did not verify. 401 — and never processed. */
  'PAYMENT_WEBHOOK_INVALID',
  /** Refunding more than was captured, or capturing something already refunded. 409. */
  'PAYMENT_STATE_INVALID',

  // Bookings (docs/LLD/booking-lifecycle.md).
  'BOOKING_NOT_FOUND',
  /** The requested status change is not in the transition table. 409. */
  'INVALID_BOOKING_TRANSITION',
  /** Wrong trip-start OTP. Never says whether the code or the booking was the problem. 400. */
  'OTP_INVALID',
  /** Five wrong OTP attempts. The booking is locked and routed to support. 429. */
  'OTP_LOCKED',
  /**
   * The driver is too far from the pickup point to mark themselves arrived. 422, and it carries
   * the measured distance so the app can say how far off they are rather than just refusing.
   */
  'DRIVER_NOT_AT_PICKUP',
  /** A location fix too old to make a decision on. 400. */
  'DRIVER_LOCATION_STALE',

  // Dispatch (docs/LLD/dispatch-and-assignment.md).
  /** Another driver won the race. NOT counted against acceptance rate. 409. */
  'ALREADY_ASSIGNED',
  'OFFER_NOT_FOUND',
  'OFFER_EXPIRED',
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
