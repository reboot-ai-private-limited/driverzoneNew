import type { SettingsSnapshot } from './domain/setting.entity.js';
import type { SettingKey } from './domain/setting.registry.js';

/**
 * PUBLIC CONTRACT — the only surface other modules may import from `settings`.
 *
 * READ-ONLY, deliberately, and for the same reason `packages.public.ts` is: the cross-key
 * invariants (non-overlapping surcharge windows, a cancellation ladder that never steps down)
 * are enforced in `UpdateSettingsUseCase`, and a second write path would demote them from a
 * guarantee to a convention. Writes are reachable over the admin HTTP surface and nowhere else.
 *
 * `snapshot()` returns plain data rather than an accessor object so that consumers stay pure:
 * `quotes` reads the config once at the top of a request and hands values down into the fare
 * calculation, instead of the fare calculation reaching out to a database mid-arithmetic.
 *
 * MONEY IS RUPEES HERE. Money keys come back branded `Rupees`, so adding one to a `*Paise` field
 * does not compile. `rupeesToPaise()` is re-exported below because it is the only legitimate way
 * across, and a consumer should not have to reach into this module's `domain/` to find it.
 */
export interface SettingsReadContract {
  /** The whole typed config, cached for 60s. Read once per request path and pass values down. */
  snapshot(): Promise<SettingsSnapshot>;
  /** One key, when a caller genuinely needs one. Reads the same cached snapshot underneath. */
  get<K extends SettingKey>(key: K): Promise<SettingsSnapshot[K]>;
}

export type SettingsPublicContract = SettingsReadContract;

export type { SettingsSnapshot } from './domain/setting.entity.js';
export type { SettingKey } from './domain/setting.registry.js';
export type { Rupees } from './domain/money.js';
export { rupeesToPaise, rupeesValue } from './domain/money.js';
