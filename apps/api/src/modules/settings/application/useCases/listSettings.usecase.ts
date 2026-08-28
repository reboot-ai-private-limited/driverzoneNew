import type { SettingGroupDto, SettingDto } from '@driverzone/contracts';
import { resolveAll } from '../../domain/setting.entity.js';
import type { SettingRepositoryPort } from '../../domain/setting.repository.port.js';
import {
  SETTING_GROUP_LABELS,
  SETTING_GROUP_ORDER,
  SETTING_REGISTRY,
} from '../../domain/setting.registry.js';

/**
 * APPLICATION — the admin view: every key, grouped, with its default alongside its current value.
 *
 * `default_value` and `is_overridden` travel with each row so the form can offer "reset this one"
 * without a second request, and so an admin can see at a glance what has been changed from
 * standard — which is usually the question they opened the page to answer.
 */
export class ListSettingsUseCase {
  constructor(private readonly settings: SettingRepositoryPort) {}

  async execute(): Promise<SettingGroupDto[]> {
    const resolved = await this.settings.findOverrides().then((o) => resolveAll(o));

    const dtos: SettingDto[] = resolved.map((setting) => {
      const definition = SETTING_REGISTRY[setting.key];
      return {
        key: setting.key,
        value: setting.value,
        default_value: setting.defaultValue,
        is_overridden: setting.isOverridden,
        group: definition.group,
        label: definition.label,
        unit: definition.unit,
        description: definition.description,
        updated_at: setting.updatedAt === null ? null : setting.updatedAt.toISOString(),
        updated_by: setting.updatedBy,
      };
    });

    // Registry declaration order inside each group; `SETTING_GROUP_ORDER` between them. Both are
    // editorial decisions about how the page reads, so both belong next to the registry.
    return SETTING_GROUP_ORDER.map((group) => ({
      group,
      label: SETTING_GROUP_LABELS[group],
      settings: dtos.filter((dto) => dto.group === group),
    })).filter((groupDto) => groupDto.settings.length > 0);
  }
}
