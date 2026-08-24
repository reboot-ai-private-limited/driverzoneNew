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
 * exactly what is wrong, per FR-Z3/FR-Z4/FR-Z5 (docs/LLD/domain-model.md).
 */
export function zoneValidationFailed(violations: ZoneViolation[]): AppError {
  return AppError.badRequest('This zone geometry fails validation.', { violations });
}

/** The partial unique index on `code` (active zones only) was about to be violated. */
export function zoneCodeInUse(code: string): AppError {
  return AppError.conflict(`A zone with code "${code}" already exists.`, { code });
}

/**
 * FR-Z6 — deactivating/deleting a zone that something still depends on.
 *
 * `details` names what depends on it, matching the admin-panel.md "blast radius" preview so the
 * same shape powers both the confirmation screen and the hard block.
 */
export function zoneHasActiveDependents(details: unknown): AppError {
  return AppError.conflict('This zone still has active dependents.', details);
}

/**
 * The branch from `zone-resolution.md` steps 3–4 that should be unreachable: a PICKUP zone
 * resolved whose parent is not an active CITY. Only reachable if Z-1 was violated at write time —
 * which `createZone`/`updateZoneGeometry` are supposed to make impossible — so this pages ops
 * rather than reading as ordinary bad input.
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
