import { AppError } from '@/shared/errors/AppError.js';
import type { InvariantViolation } from './setting.invariants.js';
import { SETTING_KEYS } from './setting.registry.js';

/**
 * DOMAIN — the failures this module is allowed to express. Factories rather than subclasses,
 * same reasoning as `zones/domain/zone.errors.ts`.
 *
 * All three carry `publicDetails`: every one of them is an admin typing into a form, and a 400
 * that does not name the offending key sends them hunting through nineteen fields.
 */

/** 400. The full key list rides along — this is an admin-only surface, and it is the fix. */
export function unknownSettingKey(keys: string[]): AppError {
  return new AppError({
    statusCode: 400,
    code: 'SETTING_UNKNOWN_KEY',
    message: keys.length === 1 ? `Unknown setting "${keys[0]}".` : 'Unknown settings in this request.',
    publicDetails: { keys, known_keys: SETTING_KEYS },
  });
}

/** 400. One entry per rejected key, carrying that key's own schema messages. */
export function settingValueInvalid(
  failures: Array<{ key: string; messages: string[] }>,
): AppError {
  return new AppError({
    statusCode: 400,
    code: 'SETTING_VALUE_INVALID',
    message: 'One or more settings have an invalid value.',
    publicDetails: { failures },
  });
}

/**
 * 422, not 400: every value was individually well-formed and the request was well-understood —
 * the combination is what the server refuses. Mirrors `ZONE_VALIDATION_FAILED`.
 */
export function settingInvariantViolated(violations: InvariantViolation[]): AppError {
  return new AppError({
    statusCode: 422,
    code: 'SETTING_INVARIANT_VIOLATED',
    message: 'These settings are individually valid but conflict with each other.',
    publicDetails: { violations },
  });
}
