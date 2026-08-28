import type { SettingValue } from '@driverzone/contracts';
import type { AuditPort } from '../../domain/audit.port.js';
import { buildSnapshot, resolveAll, type SettingOverride } from '../../domain/setting.entity.js';
import { settingInvariantViolated, settingValueInvalid, unknownSettingKey } from '../../domain/setting.errors.js';
import { checkInvariants } from '../../domain/setting.invariants.js';
import { SETTING_REGISTRY, isSettingKey, type SettingKey } from '../../domain/setting.registry.js';
import type { SettingRepositoryPort, SettingWrite } from '../../domain/setting.repository.port.js';
import type { ActorContext } from '../actorContext.js';

/**
 * APPLICATION — the only write path for settings.
 *
 * ALL-OR-NOTHING, in four ordered phases, and the order is the whole design:
 *
 *   1. every key is known                    → 400, before anything is parsed
 *   2. every value passes its own schema     → 400, all failures at once, not the first one
 *   3. the MERGED snapshot satisfies the cross-key rules → 422
 *   4. write, then audit
 *
 * Phase 3 is why this cannot be a per-key `PUT`. "Move the early morning window to 03:00" is a
 * valid edit in isolation and puts the system in a state where two surcharges claim the same
 * hour. The rule is about the resulting configuration, so it has to be checked against the
 * resulting configuration — which only exists once the patch is merged over what is stored.
 *
 * Nothing is written until all three checks pass, so a rejected batch leaves the config exactly
 * as it was. That is what lets an admin paste in a set of changes without having to reason about
 * which half of them landed.
 */
export interface UpdateSettingsResult {
  updated: SettingKey[];
}

export class UpdateSettingsUseCase {
  constructor(
    private readonly settings: SettingRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(values: Record<string, SettingValue>, actor: ActorContext): Promise<UpdateSettingsResult> {
    const entries = Object.entries(values);

    // 1 — unknown keys. Rejected rather than ignored: silently dropping a key an admin believed
    // they had just set is the failure mode that gets discovered three weeks later in a fare.
    const unknown = entries.map(([key]) => key).filter((key) => !isSettingKey(key));
    if (unknown.length > 0) throw unknownSettingKey(unknown);

    // 2 — per-key schemas. Every failure is collected, so an admin fixing a form sees all of the
    // problems rather than one per round trip.
    const failures: Array<{ key: string; messages: string[] }> = [];
    const writes: SettingWrite[] = [];

    for (const [key, value] of entries) {
      const parsed = SETTING_REGISTRY[key as SettingKey].schema.safeParse(value);
      if (parsed.success) {
        writes.push({ key, value: parsed.data });
      } else {
        failures.push({ key, messages: parsed.error.issues.map((issue) => issue.message) });
      }
    }

    if (failures.length > 0) throw settingValueInvalid(failures);

    // 3 — the resulting configuration. The patch is merged over the stored overrides as an
    // in-memory override list, so `buildSnapshot` applies exactly the same default-filling and
    // branding it will apply on the next read.
    const stored = await this.settings.findOverrides();
    const merged = mergeOverrides(stored, writes);
    const violations = checkInvariants(buildSnapshot(merged));
    if (violations.length > 0) throw settingInvariantViolated(violations);

    // 4 — write, then record. `before` is what each key resolved to a moment ago, INCLUDING the
    // case where it was at its default, because "changed from the default to 200" and "changed
    // from 150 to 200" are different events to whoever reads this log later.
    const before = new Map(resolveAll(stored).map((setting) => [setting.key as string, setting]));
    const written = await this.settings.putMany(writes, actor.adminId);

    await Promise.all(
      written.map((row) =>
        this.audit.record({
          adminId: actor.adminId,
          entityType: 'GlobalSetting',
          entityId: row.id,
          action: 'UPDATE',
          before: { key: row.key, value: before.get(row.key)?.value, was_default: before.get(row.key)?.isOverridden === false },
          after: { key: row.key, value: row.value },
          ip: actor.ip,
        }),
      ),
    );

    return { updated: writes.map((write) => write.key as SettingKey) };
  }
}

/** The stored overrides with the patch applied on top — an unsaved view of what a write produces. */
function mergeOverrides(stored: readonly SettingOverride[], writes: readonly SettingWrite[]): SettingOverride[] {
  const byKey = new Map(stored.map((override) => [override.key, override]));
  for (const write of writes) {
    const existing = byKey.get(write.key);
    byKey.set(write.key, {
      id: existing?.id ?? '',
      key: write.key,
      value: write.value,
      updatedBy: existing?.updatedBy ?? null,
      updatedAt: existing?.updatedAt ?? new Date(),
    });
  }
  return [...byKey.values()];
}
