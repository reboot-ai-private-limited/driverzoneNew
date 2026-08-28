import type { AuditPort } from '../../domain/audit.port.js';
import { buildSnapshot, resolveAll } from '../../domain/setting.entity.js';
import { settingInvariantViolated, unknownSettingKey } from '../../domain/setting.errors.js';
import { checkInvariants } from '../../domain/setting.invariants.js';
import { isSettingKey, type SettingKey } from '../../domain/setting.registry.js';
import type { SettingRepositoryPort } from '../../domain/setting.repository.port.js';
import type { ActorContext } from '../actorContext.js';

/**
 * APPLICATION — drop overrides so the registry defaults take over.
 *
 * The invariants are re-checked, which is not obvious: reverting one half of a pair can produce
 * exactly the incoherent state a write would have been refused for. Resetting the late night
 * window back to 22:00–04:00 while an edited early morning window still starts at 03:00 is the
 * concrete case, and it must fail for the same reason and with the same error as setting it.
 *
 * Resetting a key that has no override is a no-op, not an error: the caller asked for it to be at
 * its default, and it is.
 */
export interface ResetSettingsResult {
  reset: SettingKey[];
}

export class ResetSettingsUseCase {
  constructor(
    private readonly settings: SettingRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(keys: readonly string[], actor: ActorContext): Promise<ResetSettingsResult> {
    const unknown = keys.filter((key) => !isSettingKey(key));
    if (unknown.length > 0) throw unknownSettingKey(unknown);

    const stored = await this.settings.findOverrides();
    const remaining = stored.filter((override) => !keys.includes(override.key));
    const violations = checkInvariants(buildSnapshot(remaining));
    if (violations.length > 0) throw settingInvariantViolated(violations);

    const before = new Map(resolveAll(stored).map((setting) => [setting.key as string, setting]));
    const removed = await this.settings.deleteMany(keys);

    await Promise.all(
      removed.map((row) =>
        this.audit.record({
          adminId: actor.adminId,
          entityType: 'GlobalSetting',
          entityId: row.id,
          action: 'DELETE',
          before: { key: row.key, value: before.get(row.key)?.value },
          after: { key: row.key, value: null, reverted_to_default: true },
          ip: actor.ip,
        }),
      ),
    );

    return { reset: removed.map((row) => row.key as SettingKey) };
  }
}
