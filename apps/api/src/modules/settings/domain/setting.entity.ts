import type { z } from 'zod';
import type { SettingAudience, SettingValue } from '@driverzone/contracts';
import { asRupees, type Rupees } from './money.js';
import { SETTING_KEYS, SETTING_REGISTRY, type SettingKey } from './setting.registry.js';

/**
 * DOMAIN — turning "the defaults plus whatever rows exist" into one typed object.
 *
 * `SettingsSnapshot` is derived from the registry rather than declared beside it, so the two can
 * never disagree. The conditional on `unit` is the part that matters: a `RUPEES` key comes out
 * branded (`./money.ts`), so a consumer cannot add it to a paise field without going through
 * `rupeesToPaise()`. Everything else stays a plain `number` or the window object.
 */

type Definition<K extends SettingKey> = (typeof SETTING_REGISTRY)[K];

export type SettingsSnapshot = {
  [K in SettingKey]: Definition<K>['unit'] extends 'RUPEES'
    ? Rupees
    : z.infer<Definition<K>['schema']>;
};

/** One stored override. A key absent from this list is at its registry default. */
export interface SettingOverride {
  id: string;
  key: string;
  value: unknown;
  updatedBy: string | null;
  updatedAt: Date;
}

/** What a single key resolved to, and where the value came from. Backs the admin list view. */
export interface ResolvedSetting {
  key: SettingKey;
  value: SettingValue;
  defaultValue: SettingValue;
  isOverridden: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * Resolves one key. An override that no longer parses — because the schema was tightened after
 * the row was written — falls back to the default rather than propagating a value the rest of
 * the system has been told is impossible. `onInvalid` lets the caller log it; the read path must
 * not throw, since every fare calculation goes through here.
 */
function resolveOne(
  key: SettingKey,
  overrides: Map<string, SettingOverride>,
  onInvalid?: (key: SettingKey, value: unknown) => void,
): ResolvedSetting {
  const definition = SETTING_REGISTRY[key];
  const defaultValue = definition.default as SettingValue;
  const row = overrides.get(key);

  if (row === undefined) {
    return { key, value: defaultValue, defaultValue, isOverridden: false, updatedAt: null, updatedBy: null };
  }

  const parsed = definition.schema.safeParse(row.value);
  if (!parsed.success) {
    onInvalid?.(key, row.value);
    return { key, value: defaultValue, defaultValue, isOverridden: false, updatedAt: null, updatedBy: null };
  }

  return {
    key,
    value: parsed.data as SettingValue,
    defaultValue,
    isOverridden: true,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/** Every key, resolved, in registry declaration order. */
export function resolveAll(
  overrides: readonly SettingOverride[],
  onInvalid?: (key: SettingKey, value: unknown) => void,
): ResolvedSetting[] {
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  return SETTING_KEYS.map((key) => resolveOne(key, byKey, onInvalid));
}

/**
 * The typed config object the rest of the API reads.
 *
 * The cast is unavoidable and is contained here: the mapped type above is keyed by a literal
 * union that TypeScript cannot see a `reduce` producing. Correctness rests on `resolveAll`
 * returning exactly `SETTING_KEYS` — which the registry self-check test pins.
 */
export function buildSnapshot(overrides: readonly SettingOverride[], onInvalid?: (key: SettingKey, value: unknown) => void): SettingsSnapshot {
  const snapshot: Record<string, SettingValue | Rupees> = {};
  for (const resolved of resolveAll(overrides, onInvalid)) {
    snapshot[resolved.key] =
      SETTING_REGISTRY[resolved.key].unit === 'RUPEES'
        ? asRupees(resolved.value as number)
        : resolved.value;
  }
  return snapshot as SettingsSnapshot;
}

/** The flat map a customer or driver app gets — only the keys that audience is allowed to see. */
export function filterForAudience(
  resolved: readonly ResolvedSetting[],
  audience: SettingAudience,
): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  for (const setting of resolved) {
    const audiences: readonly SettingAudience[] = SETTING_REGISTRY[setting.key].audiences;
    if (audiences.includes(audience)) out[setting.key] = setting.value;
  }
  return out;
}
