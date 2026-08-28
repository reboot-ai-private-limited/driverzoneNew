import { describe, expect, it } from 'vitest';
import type { SettingDto } from '@driverzone/contracts';
import { diffDrafts, isDirty, mapFieldErrors, mergeDrafts, parseDraft, toDrafts } from './draft';

/**
 * The form logic, tested without a DOM. `vitest.config.ts` keeps this app's tests DOM-free on
 * purpose; the interesting failures here are arithmetic and diffing, not rendering.
 */

function setting(over: Partial<SettingDto> & Pick<SettingDto, 'key' | 'value' | 'unit'>): SettingDto {
  return {
    default_value: over.value,
    is_overridden: false,
    group: 'PRICING',
    label: over.key,
    description: '',
    updated_at: null,
    updated_by: null,
    ...over,
  };
}

const insurance = setting({ key: 'pricing.insurance_charge', value: 30, unit: 'RUPEES' });
const freeMinutes = setting({ key: 'waiting.free_minutes', value: 15, unit: 'MINUTES' });
const lateNight = setting({
  key: 'pricing.late_night_window',
  value: { start: '22:00', end: '04:00' },
  unit: 'TIME_WINDOW',
});
const all = [insurance, freeMinutes, lateNight];

describe('parseDraft', () => {
  it('accepts a whole rupee amount', () => {
    expect(parseDraft('50', 'RUPEES')).toEqual({ ok: true, value: 50 });
    expect(parseDraft('0', 'RUPEES')).toEqual({ ok: true, value: 0 });
  });

  it('rejects a fraction of a rupee, and says why in rupee terms', () => {
    const result = parseDraft('2.5', 'RUPEES');
    expect(result.ok).toBe(false);
    // Not "must be a whole number" — in a currency field that reads as a bug rather than a rule.
    expect(result.ok === false && result.message).toBe('Whole rupees only — no paise.');
  });

  it('rejects a fraction of a minute with the generic wording', () => {
    const result = parseDraft('2.5', 'MINUTES');
    expect(result.ok === false && result.message).toBe('Must be a whole number.');
  });

  it('rejects negatives, empties and non-numbers', () => {
    expect(parseDraft('-1', 'RUPEES').ok).toBe(false);
    expect(parseDraft('', 'RUPEES').ok).toBe(false);
    expect(parseDraft('   ', 'RUPEES').ok).toBe(false);
    expect(parseDraft('abc', 'SECONDS').ok).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDraft('  20 ', 'MINUTES')).toEqual({ ok: true, value: 20 });
  });

  it('accepts a time window, including one that wraps midnight', () => {
    expect(parseDraft({ start: '22:00', end: '04:00' }, 'TIME_WINDOW')).toEqual({
      ok: true,
      value: { start: '22:00', end: '04:00' },
    });
  });

  it('rejects a window whose start equals its end', () => {
    // Ambiguous between "empty" and "all day", so it is refused here exactly as the API refuses
    // it. Switching a surcharge off is done by setting its charge to 0.
    const result = parseDraft({ start: '22:00', end: '22:00' }, 'TIME_WINDOW');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('set its charge to 0');
  });

  it('rejects a half-filled window', () => {
    expect(parseDraft({ start: '22:00', end: '' }, 'TIME_WINDOW').ok).toBe(false);
  });

  it('refuses a draft of the wrong shape for its unit', () => {
    expect(parseDraft('22:00', 'TIME_WINDOW').ok).toBe(false);
    expect(parseDraft({ start: '1', end: '2' }, 'RUPEES').ok).toBe(false);
  });
});

describe('isDirty', () => {
  it('compares values, not text', () => {
    expect(isDirty('30', 30, 'RUPEES')).toBe(false);
    // The same setting, typed with a space. Not an edit, and must not appear in the count.
    expect(isDirty(' 30 ', 30, 'RUPEES')).toBe(false);
    expect(isDirty('31', 30, 'RUPEES')).toBe(true);
  });

  it('treats an unparseable draft as dirty', () => {
    // The admin has typed something. Calling it unchanged would let Discard silently drop it.
    expect(isDirty('', 30, 'RUPEES')).toBe(true);
    expect(isDirty('2.5', 30, 'RUPEES')).toBe(true);
  });

  it('compares windows field by field', () => {
    expect(isDirty({ start: '22:00', end: '04:00' }, { start: '22:00', end: '04:00' }, 'TIME_WINDOW')).toBe(false);
    expect(isDirty({ start: '23:00', end: '04:00' }, { start: '22:00', end: '04:00' }, 'TIME_WINDOW')).toBe(true);
  });
});

describe('diffDrafts', () => {
  it('sends nothing when nothing changed', () => {
    expect(diffDrafts(all, toDrafts(all))).toEqual({ values: {}, invalid: {}, dirtyKeys: [] });
  });

  it('sends only what changed, never the whole form', () => {
    // Sending all nineteen keys would overwrite any setting this build does not render, and would
    // turn every save into a write to every key in the audit log.
    const result = diffDrafts(all, { ...toDrafts(all), 'waiting.free_minutes': '20' });
    expect(result.values).toEqual({ 'waiting.free_minutes': 20 });
    expect(result.dirtyKeys).toEqual(['waiting.free_minutes']);
    expect(result.invalid).toEqual({});
  });

  it('separates an unsendable edit from a sendable one and still counts both as changed', () => {
    const result = diffDrafts(all, {
      ...toDrafts(all),
      'waiting.free_minutes': '20',
      'pricing.insurance_charge': '2.5',
    });
    // The valid half is ready to send, but the caller blocks on `invalid` being non-empty — the
    // API is all-or-nothing, so shipping half a batch would be a worse outcome than not saving.
    expect(result.values).toEqual({ 'waiting.free_minutes': 20 });
    expect(result.invalid).toHaveProperty('pricing.insurance_charge');
    expect(result.dirtyKeys).toHaveLength(2);
  });

  it('ignores a setting with no draft rather than sending undefined', () => {
    expect(diffDrafts(all, {}).dirtyKeys).toEqual([]);
  });

  it('picks up a window edit', () => {
    const result = diffDrafts(all, {
      ...toDrafts(all),
      'pricing.late_night_window': { start: '23:00', end: '04:00' },
    });
    expect(result.values).toEqual({ 'pricing.late_night_window': { start: '23:00', end: '04:00' } });
  });
});

describe('mapFieldErrors', () => {
  it('maps SETTING_VALUE_INVALID onto the fields that failed', () => {
    expect(
      mapFieldErrors({
        failures: [
          { key: 'pricing.insurance_charge', messages: ['Expected integer, received float'] },
          { key: 'driver.late_fine', messages: ['Number must be greater than or equal to 0'] },
        ],
      }),
    ).toEqual({
      'pricing.insurance_charge': 'Expected integer, received float',
      'driver.late_fine': 'Number must be greater than or equal to 0',
    });
  });

  it('joins several messages for one field', () => {
    expect(mapFieldErrors({ failures: [{ key: 'a', messages: ['One', 'Two'] }] })).toEqual({
      a: 'One. Two',
    });
  });

  it('lights up EVERY key named by an invariant, not just the edited one', () => {
    // The admin moved the early morning window; the late night one is equally at fault and
    // equally in need of a message, or the fix looks like it has to happen in the field they
    // touched.
    expect(
      mapFieldErrors({
        violations: [
          {
            keys: ['pricing.early_morning_window', 'pricing.late_night_window'],
            message: 'The early morning and late night windows overlap.',
          },
        ],
      }),
    ).toEqual({
      'pricing.early_morning_window': 'The early morning and late night windows overlap.',
      'pricing.late_night_window': 'The early morning and late night windows overlap.',
    });
  });

  it('returns nothing for an error with no field detail', () => {
    // A 403 or a network fault has no box to attach itself to and is left to the toast.
    expect(mapFieldErrors(undefined)).toEqual({});
    expect(mapFieldErrors(null)).toEqual({});
    expect(mapFieldErrors({ retry_after_seconds: 30 })).toEqual({});
    expect(mapFieldErrors('nope')).toEqual({});
  });

  it('ignores malformed entries rather than throwing into the error handler', () => {
    // This runs inside an onError. Throwing here would replace a useful field message with an
    // unhandled rejection.
    expect(mapFieldErrors({ failures: [{ key: 1, messages: 'no' }, null] })).toEqual({});
    expect(mapFieldErrors({ violations: [{ keys: 'a', message: 2 }] })).toEqual({});
  });
});

describe('mergeDrafts', () => {
  const fresh = { a: '1', b: '2', c: '3' };

  it('takes the server value for everything untouched', () => {
    expect(mergeDrafts(fresh, { a: '99', b: '99', c: '99' }, [])).toEqual(fresh);
  });

  it('keeps the fields the admin is still editing', () => {
    // The case this exists for: resetting `c` refetches, and `a`'s unsaved edit must survive it.
    expect(mergeDrafts(fresh, { a: '99', b: '2', c: '99' }, ['a'])).toEqual({
      a: '99',
      b: '2',
      c: '3',
    });
  });

  it('lets a just-reset field take the server value even though the draft still differs', () => {
    // Right after a reset the local draft holds the override that was deleted. It reads as
    // "edited", so a value-based rule would keep showing the old number forever; the explicit
    // touched list is what distinguishes the two.
    expect(mergeDrafts({ c: '3' }, { c: '99' }, [])).toEqual({ c: '3' });
  });

  it('does not resurrect a key the server no longer sends', () => {
    expect(mergeDrafts({ a: '1' }, { a: '9', gone: '9' }, ['a', 'gone'])).toEqual({ a: '9' });
  });

  it('does not mutate either input', () => {
    const current = { a: '99', b: '2', c: '3' };
    const snapshot = { ...fresh };
    mergeDrafts(fresh, current, ['a']);
    expect(fresh).toEqual(snapshot);
    expect(current).toEqual({ a: '99', b: '2', c: '3' });
  });
});
