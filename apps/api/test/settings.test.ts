import { describe, expect, it, vi } from 'vitest';
import {
  SETTING_KEYS,
  SETTING_REGISTRY,
  type SettingKey,
} from '../src/modules/settings/domain/setting.registry.js';
import {
  buildSnapshot,
  filterForAudience,
  resolveAll,
  type SettingOverride,
} from '../src/modules/settings/domain/setting.entity.js';
import { checkInvariants } from '../src/modules/settings/domain/setting.invariants.js';
import { rupeesToPaise } from '../src/modules/settings/domain/money.js';
import { UpdateSettingsUseCase } from '../src/modules/settings/application/useCases/updateSettings.usecase.js';
import { ResetSettingsUseCase } from '../src/modules/settings/application/useCases/resetSettings.usecase.js';
import { ListSettingsUseCase } from '../src/modules/settings/application/useCases/listSettings.usecase.js';
import { GetAudienceSettingsUseCase } from '../src/modules/settings/application/useCases/getAudienceSettings.usecase.js';
import { GetSettingsSnapshotUseCase } from '../src/modules/settings/application/useCases/getSettingsSnapshot.usecase.js';
import { CachedSettingRepository } from '../src/modules/settings/infrastructure/cachedSetting.repository.js';
import type {
  SettingRepositoryPort,
  SettingWrite,
} from '../src/modules/settings/domain/setting.repository.port.js';
import type { AuditEntry, AuditPort } from '../src/modules/settings/domain/audit.port.js';

/** An in-memory stand-in for the `globalSettings` collection. */
function fakeRepo(seed: Array<{ key: string; value: unknown }> = []) {
  const rows = new Map<string, SettingOverride>(
    seed.map((s, i) => [
      s.key,
      { id: `row${i}`, key: s.key, value: s.value, updatedBy: 'admin1', updatedAt: new Date('2026-08-01') },
    ]),
  );

  const repo: SettingRepositoryPort & { rows: Map<string, SettingOverride> } = {
    rows,
    findOverrides: async () => [...rows.values()],
    putMany: async (writes: readonly SettingWrite[], updatedBy: string) =>
      writes.map((w) => {
        const row: SettingOverride = {
          id: rows.get(w.key)?.id ?? `row-${w.key}`,
          key: w.key,
          value: w.value,
          updatedBy,
          updatedAt: new Date(),
        };
        rows.set(w.key, row);
        return row;
      }),
    deleteMany: async (keys: readonly string[]) => {
      const removed = keys.map((k) => rows.get(k)).filter((r): r is SettingOverride => r !== undefined);
      for (const row of removed) rows.delete(row.key);
      return removed;
    },
  };
  return repo;
}

function fakeAudit(): AuditPort & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return { entries, record: async (e) => void entries.push(e) };
}

const actor = { adminId: '507f1f77bcf86cd799439011', ip: '10.0.0.1' };

describe('Settings Module', () => {
  describe('Registry', () => {
    /**
     * The registry's defaults are never validated at runtime in production — an absent row means
     * "use the default" and the default is trusted. This test IS that validation, moved to CI:
     * a default that fails its own schema would otherwise ship and only surface as a bad fare.
     */
    it.each(SETTING_KEYS)('%s has a default that passes its own schema', (key) => {
      const definition = SETTING_REGISTRY[key];
      const parsed = definition.schema.safeParse(definition.default);
      expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
    });

    it.each(SETTING_KEYS)('%s declares ADMIN in its audiences', (key) => {
      expect(SETTING_REGISTRY[key].audiences).toContain('ADMIN');
    });

    /**
     * Money is WHOLE RUPEES, everywhere (docs/LLD/database-schema.md §Conventions records this as
     * the one exception to the paise rule). A table test over the registry rather than a list of
     * keys, so a money setting added next year inherits the check without anyone remembering to.
     */
    it.each(SETTING_KEYS.filter((k) => SETTING_REGISTRY[k].unit === 'RUPEES'))(
      '%s rejects a fraction of a rupee and a negative amount',
      (key) => {
        const { schema } = SETTING_REGISTRY[key];
        expect(schema.safeParse(2.5).success).toBe(false);
        expect(schema.safeParse(-1).success).toBe(false);
        expect(schema.safeParse(0).success).toBe(true);
      },
    );

    it('rejects a time window whose start equals its end', () => {
      const { schema } = SETTING_REGISTRY['pricing.late_night_window'];
      expect(schema.safeParse({ start: '22:00', end: '22:00' }).success).toBe(false);
      expect(schema.safeParse({ start: '25:00', end: '04:00' }).success).toBe(false);
      expect(schema.safeParse({ start: '22:00', end: '04:00' }).success).toBe(true);
    });
  });

  describe('Snapshot', () => {
    it('returns every default when no override exists', () => {
      const snapshot = buildSnapshot([]);
      expect(Object.keys(snapshot).sort()).toEqual([...SETTING_KEYS].sort());
      expect(snapshot['pricing.insurance_charge']).toBe(30);
      expect(snapshot['waiting.free_minutes']).toBe(15);
    });

    it('brands money as rupees, so the only route to paise is rupeesToPaise', () => {
      const snapshot = buildSnapshot([]);
      // The brand is erased at runtime — the guarantee is the compile error at the call site
      // `baseFarePaise + snapshot['pricing.insurance_charge']`, which tsc enforces. What this
      // asserts is that the conversion the brand forces you through is correct.
      expect(rupeesToPaise(snapshot['pricing.insurance_charge'])).toBe(3000);
    });

    it('falls back to the default when a stored value no longer parses', () => {
      const onInvalid = vi.fn();
      const snapshot = buildSnapshot(
        [{ id: 'r', key: 'pricing.insurance_charge', value: 12.5, updatedBy: null, updatedAt: new Date() }],
        onInvalid,
      );
      // A read path under every fare calculation must not throw over a value someone hand-edited.
      expect(snapshot['pricing.insurance_charge']).toBe(30);
      expect(onInvalid).toHaveBeenCalledWith('pricing.insurance_charge', 12.5);
    });

    it('marks an overridden key as overridden and carries its provenance', async () => {
      const resolved = resolveAll(await fakeRepo([{ key: 'waiting.free_minutes', value: 20 }]).findOverrides());
      const waiting = resolved.find((r) => r.key === 'waiting.free_minutes');
      expect(waiting).toMatchObject({ value: 20, defaultValue: 15, isOverridden: true, updatedBy: 'admin1' });
      const insurance = resolved.find((r) => r.key === 'pricing.insurance_charge');
      expect(insurance).toMatchObject({ isOverridden: false, updatedAt: null, updatedBy: null });
    });
  });

  describe('Cross-key invariants', () => {
    const withOverrides = (overrides: Record<string, unknown>) =>
      buildSnapshot(
        Object.entries(overrides).map(([key, value], i) => ({
          id: `r${i}`, key, value, updatedBy: null, updatedAt: new Date(),
        })),
      );

    it('accepts the shipped defaults', () => {
      expect(checkInvariants(buildSnapshot([]))).toEqual([]);
    });

    it('rejects overlapping surcharge windows, including across midnight', () => {
      // Late night defaults to 22:00–04:00, so an early morning window starting at 03:00 lands
      // inside its wrapped half — the case a naive start<end comparison misses.
      const violations = checkInvariants(
        withOverrides({ 'pricing.early_morning_window': { start: '03:00', end: '06:00' } }),
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.keys).toContain('pricing.late_night_window');
    });

    it('accepts windows that touch but do not overlap', () => {
      // 22:00–04:00 and 04:00–06:00: `end` is exclusive, so 04:00 belongs to exactly one of them.
      expect(checkInvariants(buildSnapshot([]))).toEqual([]);
      expect(
        checkInvariants(withOverrides({ 'pricing.early_morning_window': { start: '04:00', end: '05:00' } })),
      ).toEqual([]);
    });

    it('rejects a no-show timer at or before the free waiting window', () => {
      expect(checkInvariants(withOverrides({ 'waiting.no_show_after_minutes': 15 }))).toHaveLength(1);
      expect(checkInvariants(withOverrides({ 'waiting.no_show_after_minutes': 10 }))).toHaveLength(1);
      expect(checkInvariants(withOverrides({ 'waiting.no_show_after_minutes': 16 }))).toEqual([]);
    });

    it('rejects a cancellation ladder that steps down', () => {
      // Cheaper to cancel at the door than en route rewards waiting until the driver arrives.
      expect(checkInvariants(withOverrides({ 'cancellation.customer_fee_arrived': 20 }))).toHaveLength(1);
      expect(checkInvariants(withOverrides({ 'cancellation.driver_penalty_arrived': 20 }))).toHaveLength(1);
      expect(checkInvariants(withOverrides({ 'cancellation.customer_fee_arrived': 50 }))).toEqual([]);
    });
  });

  describe('UpdateSettingsUseCase', () => {
    it('writes a valid batch and audits one row per key', async () => {
      const repo = fakeRepo();
      const audit = fakeAudit();
      const result = await new UpdateSettingsUseCase(repo, audit).execute(
        { 'waiting.free_minutes': 20, 'pricing.insurance_charge': 50 },
        actor,
      );

      expect(result.updated).toEqual(['waiting.free_minutes', 'pricing.insurance_charge']);
      expect(repo.rows.get('waiting.free_minutes')?.value).toBe(20);
      expect(audit.entries).toHaveLength(2);
      expect(audit.entries[0]).toMatchObject({ entityType: 'GlobalSetting', action: 'UPDATE' });
      // "changed from the default" and "changed from a previous override" are different events.
      expect(audit.entries[0]?.before).toMatchObject({ value: 15, was_default: true });
    });

    it('rejects an unknown key without storing an orphan row', async () => {
      const repo = fakeRepo();
      await expect(
        new UpdateSettingsUseCase(repo, fakeAudit()).execute({ 'pickup.default_chrage': 100 }, actor),
      ).rejects.toMatchObject({ statusCode: 400, code: 'SETTING_UNKNOWN_KEY' });
      expect(repo.rows.size).toBe(0);
    });

    it('is all-or-nothing: one bad value in a batch writes nothing', async () => {
      const repo = fakeRepo();
      const audit = fakeAudit();
      await expect(
        new UpdateSettingsUseCase(repo, audit).execute(
          { 'waiting.free_minutes': 20, 'pricing.insurance_charge': 2.5 },
          actor,
        ),
      ).rejects.toMatchObject({ statusCode: 400, code: 'SETTING_VALUE_INVALID' });

      // The valid half of the batch must not have landed.
      expect(repo.rows.size).toBe(0);
      expect(audit.entries).toHaveLength(0);
    });

    it('reports every invalid value at once, not just the first', async () => {
      const error = await new UpdateSettingsUseCase(fakeRepo(), fakeAudit())
        .execute({ 'pricing.insurance_charge': 2.5, 'driver.late_fine': -1 }, actor)
        .catch((e: { publicDetails: { failures: unknown[] } }) => e);
      expect((error as { publicDetails: { failures: unknown[] } }).publicDetails.failures).toHaveLength(2);
    });

    it('checks invariants against the merged result, not the patch alone', async () => {
      const repo = fakeRepo();
      // Individually valid — 03:00–06:00 is a well-formed window — and jointly incoherent with
      // the stored (default) late-night window it would sit inside.
      await expect(
        new UpdateSettingsUseCase(repo, fakeAudit()).execute(
          { 'pricing.early_morning_window': { start: '03:00', end: '06:00' } },
          actor,
        ),
      ).rejects.toMatchObject({ statusCode: 422, code: 'SETTING_INVARIANT_VIOLATED' });
      expect(repo.rows.size).toBe(0);
    });

    it('accepts a batch that is only coherent taken together', async () => {
      const repo = fakeRepo();
      // Moving both windows at once is fine; moving either one alone would be rejected.
      await new UpdateSettingsUseCase(repo, fakeAudit()).execute(
        {
          'pricing.early_morning_window': { start: '03:00', end: '06:00' },
          'pricing.late_night_window': { start: '23:00', end: '03:00' },
        },
        actor,
      );
      expect(repo.rows.size).toBe(2);
    });
  });

  describe('ResetSettingsUseCase', () => {
    it('removes the override so the default takes over, and audits it', async () => {
      const repo = fakeRepo([{ key: 'waiting.free_minutes', value: 20 }]);
      const audit = fakeAudit();
      const result = await new ResetSettingsUseCase(repo, audit).execute(['waiting.free_minutes'], actor);

      expect(result.reset).toEqual(['waiting.free_minutes']);
      expect(buildSnapshot(await repo.findOverrides())['waiting.free_minutes']).toBe(15);
      expect(audit.entries[0]).toMatchObject({ action: 'DELETE', entityType: 'GlobalSetting' });
      expect(audit.entries[0]?.before).toMatchObject({ value: 20 });
    });

    it('is a no-op for a key that was never overridden', async () => {
      const audit = fakeAudit();
      const result = await new ResetSettingsUseCase(fakeRepo(), audit).execute(['driver.late_fine'], actor);
      expect(result.reset).toEqual([]);
      expect(audit.entries).toHaveLength(0);
    });

    it('refuses a reset that would leave the config incoherent', async () => {
      // Both windows were moved together; reverting only one puts them back on top of each other.
      const repo = fakeRepo([
        { key: 'pricing.early_morning_window', value: { start: '03:00', end: '06:00' } },
        { key: 'pricing.late_night_window', value: { start: '23:00', end: '03:00' } },
      ]);
      await expect(
        new ResetSettingsUseCase(repo, fakeAudit()).execute(['pricing.late_night_window'], actor),
      ).rejects.toMatchObject({ statusCode: 422, code: 'SETTING_INVARIANT_VIOLATED' });
      expect(repo.rows.size).toBe(2);
    });
  });

  describe('Audience filtering', () => {
    it('gives a customer the fees they can be charged and none of the driver ones', async () => {
      const settings = await new GetAudienceSettingsUseCase(fakeRepo()).execute('CUSTOMER');
      expect(settings['cancellation.customer_fee_arrived']).toBe(100);
      expect(settings['pricing.insurance_charge']).toBe(30);
      // A customer must never be able to read the driver's penalty schedule.
      expect(settings['driver.late_fine']).toBeUndefined();
      expect(settings['cancellation.driver_penalty_arrived']).toBeUndefined();
    });

    it('gives a driver their own rules and not the customer fee ladder', async () => {
      const settings = await new GetAudienceSettingsUseCase(fakeRepo()).execute('DRIVER');
      expect(settings['dispatch.offer_ttl_seconds']).toBe(45);
      expect(settings['driver.late_fine']).toBe(50);
      expect(settings['cancellation.customer_fee_arrived']).toBeUndefined();
      expect(settings['pricing.insurance_charge']).toBeUndefined();
    });

    it('gives an admin every key', () => {
      expect(Object.keys(filterForAudience(resolveAll([]), 'ADMIN'))).toHaveLength(SETTING_KEYS.length);
    });
  });

  describe('ListSettingsUseCase', () => {
    it('groups every key and never returns an empty group', async () => {
      const groups = await new ListSettingsUseCase(fakeRepo([{ key: 'driver.late_fine', value: 75 }])).execute();
      const all = groups.flatMap((g) => g.settings);

      expect(all).toHaveLength(SETTING_KEYS.length);
      expect(groups.every((g) => g.settings.length > 0)).toBe(true);
      expect(groups.map((g) => g.group)).toEqual(['PICKUP', 'PRICING', 'WAITING', 'DRIVER', 'DISPATCH', 'CANCELLATION']);

      const fine = all.find((s) => s.key === 'driver.late_fine');
      expect(fine).toMatchObject({ value: 75, default_value: 50, is_overridden: true, unit: 'RUPEES' });
      // Every row carries what the phase-2 form needs to render itself.
      expect(fine?.label).toBeTruthy();
      expect(fine?.description).toBeTruthy();
    });
  });

  describe('CachedSettingRepository', () => {
    it('serves a second read inside the TTL without hitting the store', async () => {
      const inner = fakeRepo();
      const spy = vi.spyOn(inner, 'findOverrides');
      const cached = new CachedSettingRepository(inner, 60_000);

      await cached.findOverrides();
      await cached.findOverrides();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('re-reads once the TTL has passed', async () => {
      const inner = fakeRepo();
      const spy = vi.spyOn(inner, 'findOverrides');
      let now = 0;
      const cached = new CachedSettingRepository(inner, 60_000, () => now);

      await cached.findOverrides();
      now = 59_999;
      await cached.findOverrides();
      expect(spy).toHaveBeenCalledTimes(1);
      now = 60_001;
      await cached.findOverrides();
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('clears immediately on a write, so an admin who saves and reloads sees the change', async () => {
      const inner = fakeRepo();
      const cached = new CachedSettingRepository(inner, 60_000);

      await new GetSettingsSnapshotUseCase(cached).execute();
      await new UpdateSettingsUseCase(cached, fakeAudit()).execute({ 'waiting.free_minutes': 25 }, actor);

      expect((await new GetSettingsSnapshotUseCase(cached).execute())['waiting.free_minutes']).toBe(25);
    });

    it('clears on a reset too', async () => {
      const inner = fakeRepo([{ key: 'waiting.free_minutes', value: 25 }]);
      const cached = new CachedSettingRepository(inner, 60_000);

      expect((await new GetSettingsSnapshotUseCase(cached).execute())['waiting.free_minutes']).toBe(25);
      await new ResetSettingsUseCase(cached, fakeAudit()).execute(['waiting.free_minutes'], actor);
      expect((await new GetSettingsSnapshotUseCase(cached).execute())['waiting.free_minutes']).toBe(15);
    });
  });
});
