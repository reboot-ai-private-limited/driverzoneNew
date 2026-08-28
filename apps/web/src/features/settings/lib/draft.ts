import type { SettingDto, SettingUnit, SettingValue } from '@driverzone/contracts';

/**
 * The form's own state, and the rules for turning it back into wire values.
 *
 * Pure and framework-free so it can be tested in `node` — `vitest.config.ts` keeps this app's
 * tests DOM-free on purpose, and this is the half of the screen where a mistake is expensive.
 *
 * EVERY DRAFT IS STRINGS, including the numbers. That is what a text input holds, and it is the
 * only representation in which "the admin has cleared this box" is distinguishable from zero. The
 * conversion back to numbers happens once, in `parseDraft`, rather than in every onChange.
 */

/** Mirrors `SettingValue` (`number | TimeWindow`) with strings in place of the numbers. */
export type Draft = string | { start: string; end: string };

export type Drafts = Record<string, Draft>;

export function toDraft(value: SettingValue): Draft {
  return typeof value === 'number' ? String(value) : { start: value.start, end: value.end };
}

/** Seeds the whole form from what the server currently has. */
export function toDrafts(settings: readonly SettingDto[]): Drafts {
  return Object.fromEntries(settings.map((setting) => [setting.key, toDraft(setting.value)]));
}

export function isWindowDraft(draft: Draft): draft is { start: string; end: string } {
  return typeof draft !== 'string';
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ParseFailure {
  ok: false;
  message: string;
}
export type ParseResult = { ok: true; value: SettingValue } | ParseFailure;

/**
 * Client-side validation, deliberately limited to the SHAPE of one field: is this a whole number,
 * is this a real time of day. It exists for the feedback loop — a message under the box as you
 * type beats a round trip — and not to be a second copy of the rules.
 *
 * THE SERVER IS STILL AUTHORITATIVE, and the rules it holds that this cannot are the interesting
 * ones: the two surcharge windows must not overlap, no-show must be later than free waiting,
 * neither cancellation ladder may step down. Those are about PAIRS of keys and are checked
 * against the configuration the save would produce, so they can only be answered where the whole
 * configuration is. A save is never gated on this function agreeing — it gates only on the field
 * being parseable at all, because an unparseable field has no value to send.
 */
export function parseDraft(draft: Draft, unit: SettingUnit): ParseResult {
  if (unit === 'TIME_WINDOW') {
    if (!isWindowDraft(draft)) return { ok: false, message: 'Expected a time window.' };
    if (!HH_MM.test(draft.start) || !HH_MM.test(draft.end)) {
      return { ok: false, message: 'Both times must be set.' };
    }
    // Rejected rather than read as "empty" or "all day", because those are opposite readings of
    // the same input. The way to switch a surcharge off is to set its charge to 0.
    if (draft.start === draft.end) {
      return { ok: false, message: 'Start and end must differ. To switch a surcharge off, set its charge to 0.' };
    }
    return { ok: true, value: { start: draft.start, end: draft.end } };
  }

  if (isWindowDraft(draft)) return { ok: false, message: 'Expected a number.' };

  const text = draft.trim();
  if (text === '') return { ok: false, message: 'Required.' };

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { ok: false, message: 'Must be a number.' };
  if (!Number.isInteger(parsed)) {
    // Whole rupees only, by design — see the note in `endpoints/settings.ts`. Worth spelling out
    // in the money case, since "no decimals" in a currency field reads as a bug otherwise.
    return {
      ok: false,
      message: unit === 'RUPEES' ? 'Whole rupees only — no paise.' : 'Must be a whole number.',
    };
  }
  if (parsed < 0) return { ok: false, message: 'Cannot be negative.' };

  return { ok: true, value: parsed };
}

/** Compared as VALUES, not as text: `"20"` and `"20 "` are the same setting, not an edit. */
export function isDirty(draft: Draft, original: SettingValue, unit: SettingUnit): boolean {
  const parsed = parseDraft(draft, unit);
  // An unparseable draft is always dirty — the admin has typed something, and treating it as
  // unchanged would let a half-finished edit vanish silently on discard.
  if (!parsed.ok) return true;
  return JSON.stringify(parsed.value) !== JSON.stringify(original);
}

export interface DiffResult {
  /** What to PATCH. Only keys that actually changed AND parse. */
  values: Record<string, SettingValue>;
  /** Keys the admin has edited into something unsendable, with the reason. Blocks the save. */
  invalid: Record<string, string>;
  /** Every edited key, parseable or not — what the "N unsaved changes" count is counting. */
  dirtyKeys: string[];
}

/**
 * What has changed, ready to send.
 *
 * Only the difference goes on the wire, never the whole form. Sending all nineteen keys would
 * work today and be wrong the moment a setting is added that this build of the panel does not
 * render: the admin's blank copy of it would overwrite the real value on an unrelated edit. It
 * also turns every save into a write to every key, which makes the audit log useless for the
 * question it exists to answer.
 */
export function diffDrafts(settings: readonly SettingDto[], drafts: Drafts): DiffResult {
  const values: Record<string, SettingValue> = {};
  const invalid: Record<string, string> = {};
  const dirtyKeys: string[] = [];

  for (const setting of settings) {
    const draft = drafts[setting.key];
    if (draft === undefined) continue;
    if (!isDirty(draft, setting.value, setting.unit)) continue;

    dirtyKeys.push(setting.key);

    const parsed = parseDraft(draft, setting.unit);
    if (parsed.ok) values[setting.key] = parsed.value;
    else invalid[setting.key] = parsed.message;
  }

  return { values, invalid, dirtyKeys };
}

/**
 * A fresh payload from the server, with the fields the admin is still editing left alone.
 *
 * Every save and every reset invalidates the settings query, so a new payload arrives and the
 * screen reseeds. A plain reseed would discard every OTHER field the admin had edited and not yet
 * saved — click Reset on one row and three half-finished edits elsewhere vanish.
 *
 * `touchedKeys` has to be tracked explicitly rather than derived by comparing drafts to server
 * values, because those two cases look identical from the outside: right after a reset, the local
 * draft for that key still holds the override that was just deleted, so it reads as "edited" and
 * a value-based rule would keep showing it.
 */
export function mergeDrafts(fresh: Drafts, current: Drafts, touchedKeys: readonly string[]): Drafts {
  const merged: Drafts = { ...fresh };
  for (const key of touchedKeys) {
    const draft = current[key];
    // Both guards matter. No draft means there is nothing to preserve; not being in `fresh` means
    // the server no longer defines this setting, and carrying the local draft forward would keep
    // a key alive that nothing renders and nothing can save.
    if (draft !== undefined && key in fresh) merged[key] = draft;
  }
  return merged;
}

/**
 * The server's rejection, mapped back onto the fields that caused it.
 *
 * Both settings faults carry enough structure to do this, and using it is the difference between
 * "Settings update failed" at the top of a nineteen-field page and a red message under the two
 * boxes at fault:
 *
 *   `SETTING_VALUE_INVALID`      — `{ failures: [{ key, messages }] }`, one per rejected field
 *   `SETTING_INVARIANT_VIOLATED` — `{ violations: [{ keys, message }] }`, where `keys` names
 *                                  EVERY field in the rule, so both sides of an overlapping pair
 *                                  light up rather than only the one that was touched
 *
 * The server's wording is used verbatim. Copy built from `code` would render a fallback string
 * for a rule added server-side after this build shipped.
 *
 * Anything else — a 403, a network fault — returns `{}` and is left to the toast, which is where
 * an error with no field to attach itself to belongs.
 */
export function mapFieldErrors(data: unknown): Record<string, string> {
  if (typeof data !== 'object' || data === null) return {};
  const body = data as { failures?: unknown; violations?: unknown };
  const errors: Record<string, string> = {};

  // Every entry is checked for being an object BEFORE its fields are read. This runs inside an
  // `onError`, so a malformed payload throwing here would replace the field messages with an
  // unhandled rejection — the one place a defensive check earns its keep.
  if (Array.isArray(body.failures)) {
    for (const entry of body.failures) {
      if (typeof entry !== 'object' || entry === null) continue;
      const failure = entry as { key?: unknown; messages?: unknown };
      if (typeof failure.key !== 'string' || !Array.isArray(failure.messages)) continue;
      errors[failure.key] = failure.messages.join('. ');
    }
  }

  if (Array.isArray(body.violations)) {
    for (const entry of body.violations) {
      if (typeof entry !== 'object' || entry === null) continue;
      const violation = entry as { keys?: unknown; message?: unknown };
      if (!Array.isArray(violation.keys) || typeof violation.message !== 'string') continue;
      for (const key of violation.keys) {
        if (typeof key === 'string') errors[key] = violation.message;
      }
    }
  }

  return errors;
}
