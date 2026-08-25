import type { ZoneViolation } from '@driverzone/geo';
import { AppError } from '@/shared/errors/AppError.js';

/**
 * DOMAIN — the failures this module is allowed to express.
 *
 * Factories rather than subclasses, same reasoning as `identity/domain/identity.errors.ts`:
 * `AppError` already carries everything that varies.
 */

export function zoneNotFound(): AppError {
  return AppError.notFound('Zone not found.');
}

/**
 * Any ERROR-severity violation from `validateZone()` (`@driverzone/geo`). `publicDetails` carries
 * the full violation list — including `offendingGeometry` — so the admin map editor can render
 * exactly what is wrong. `docs/LLD/zones.md` §Codes: 422, `ZONE_VALIDATION_FAILED`.
 */
export function zoneValidationFailed(violations: ZoneViolation[]): AppError {
  return new AppError({
    statusCode: 422,
    code: 'ZONE_VALIDATION_FAILED',
    message: 'This zone geometry fails validation.',
    publicDetails: { violations },
  });
}

/** The partial unique index on `code` (active zones only) was about to be violated. 409. */
export function zoneCodeInUse(code: string): AppError {
  return new AppError({
    statusCode: 409,
    code: 'ZONE_CODE_TAKEN',
    message: `A zone with code "${code}" already exists.`,
    publicDetails: { code },
  });
}

/**
 * `updateGeometry`'s `expectedVersion` didn't match the zone's current version — either it was
 * already edited elsewhere, or the caller has a stale copy. 409, per `zones.md` §Codes.
 *
 * Two admins editing the same polygon from two tabs must produce one save and one clear error,
 * never a silent last-write-wins.
 */
export function zoneAlreadySuperseded(zoneId: string, currentVersion: number): AppError {
  return new AppError({
    statusCode: 409,
    code: 'ZONE_ALREADY_SUPERSEDED',
    message: 'This zone was edited by someone else. Reload it and try again.',
    publicDetails: { zoneId, currentVersion },
  });
}

/**
 * Hard delete refused — the zone is still active. 409. Deactivate it first
 * (`DELETE /admin/zones/:id`), which is reversible; a hard delete is not.
 */
export function zoneStillActive(zoneId: string): AppError {
  return new AppError({
    statusCode: 409,
    code: 'ZONE_STILL_ACTIVE',
    message: 'Deactivate this zone before deleting it permanently.',
    publicDetails: { zoneId },
  });
}

/**
 * A resolution that is internally inconsistent in a way the write path should have prevented.
 * Narrow now that pickup zones have no parent to disagree with (docs/decision-log.md, 2026-08-25)
 * — this is a genuine "should be impossible" fault, not routine bad input, so it pages ops.
 */
export function zoneConfigFault(zoneId: string, reason: string): AppError {
  return AppError.internal('ZONE_CONFIG_FAULT', { zoneId, reason });
}

/**
 * More than one active zone of the same type matched a point — Z-2 has been violated. Defensive:
 * `createZone`/`updateZoneGeometry` should make this impossible, same posture as `zoneConfigFault`.
 */
export function ambiguousZoneMatch(zoneIds: string[], type: string): AppError {
  return AppError.internal('AMBIGUOUS_ZONE_MATCH', { zoneIds, type });
}
