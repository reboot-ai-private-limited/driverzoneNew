/**
 * Global settings — the numbers ops tunes without a deploy.
 *
 * `apps/api` compiles with `exactOptionalPropertyTypes`, so every REQUEST field below spells out
 * `| undefined` explicitly where it is optional (see `zones.ts` for the full convention).
 * Response/DTO shapes are hand-built and never parsed by Zod, so they do not need it.
 *
 * MONEY IS IN WHOLE RUPEES HERE — not paise. `globalSettings` is the one deliberate exception to
 * the paise convention in docs/LLD/database-schema.md §Conventions: these are ops-facing round
 * figures and a paise input in an admin form is bad UX. Server-side arithmetic is protected by
 * the branded `Rupees` type in `apps/api/src/modules/settings/domain/money.ts`; on the wire a
 * `RUPEES` value is a plain JSON integer, and any client mixing it with a `*_paise` field is
 * off by 100.
 */

/**
 * Every unit but `TIME_WINDOW` is a plain integer on the wire, which is what lets the admin form
 * render one number input for all of them and switch only on the suffix. Adding a unit whose
 * value is NOT a number — a list of wave radii, say — widens `SettingValue` below and breaks
 * that, so it needs the form to grow a control at the same time.
 */
export const SETTING_UNITS = [
  'RUPEES',
  'MINUTES',
  'SECONDS',
  'HOURS',
  'COUNT',
  'METRES',
  'BPS',
  'TIME_WINDOW',
] as const;
export type SettingUnit = (typeof SETTING_UNITS)[number];

export const SETTING_GROUPS = [
  'PICKUP',
  'PRICING',
  'WAITING',
  'DRIVER',
  'DISPATCH',
  'CANCELLATION',
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * Who may read a setting. Structurally the same as `Role`, but named separately on purpose: this
 * is a disclosure decision per key, not an authentication one, and the day a fourth audience
 * exists that is not a login role (a partner API, say) the two should not have to move together.
 */
export type SettingAudience = 'ADMIN' | 'CUSTOMER' | 'DRIVER';

/** IST wall-clock `HH:mm`, inclusive of `start` and exclusive of `end`. May wrap midnight. */
export interface TimeWindow {
  start: string;
  end: string;
}

/**
 * Every value a setting can hold. Deliberately narrow: the admin form renders from `unit`, and a
 * union of two shapes is one the UI can switch on exhaustively. Widening this to `unknown` would
 * make every consumer cast.
 */
export type SettingValue = number | TimeWindow;

export interface SettingDto {
  key: string;
  value: SettingValue;
  /** What the value reverts to on reset. Lives in code, never in the database. */
  default_value: SettingValue;
  /** False when no row exists for this key — the default is in force. */
  is_overridden: boolean;
  group: SettingGroup;
  label: string;
  unit: SettingUnit;
  description: string;
  /** Null while the default is in force. */
  updated_at: string | null;
  updated_by: string | null;
}

export interface SettingGroupDto {
  group: SettingGroup;
  label: string;
  settings: SettingDto[];
}

export interface GetSettingsResponse {
  groups: SettingGroupDto[];
}

/**
 * Bulk and all-or-nothing: cross-key invariants (non-overlapping surcharge windows, a
 * cancellation ladder that never steps down) are checked against the MERGED result, so a batch
 * that is individually valid and jointly incoherent must fail whole rather than half-write.
 */
export interface PatchSettingsRequest {
  values: Record<string, SettingValue>;
}

export interface PatchSettingsResponse {
  updated: string[];
}

/** Deletes the named overrides; the registry defaults take over. */
export interface ResetSettingsRequest {
  keys: string[];
}

export interface ResetSettingsResponse {
  reset: string[];
}

/**
 * What a customer or driver app is allowed to see — a flat map, filtered by the `audiences` each
 * registry entry declares. That declaration is what makes "never charge a fee the customer
 * hasn't seen" (docs/LLD/booking-lifecycle.md) mechanical rather than a convention.
 */
export interface AudienceSettingsResponse {
  settings: Record<string, SettingValue>;
}
