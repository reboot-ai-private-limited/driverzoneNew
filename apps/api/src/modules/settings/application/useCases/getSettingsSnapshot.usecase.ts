import { logger } from '@/shared/logging/logger.js';
import { buildSnapshot, type SettingsSnapshot } from '../../domain/setting.entity.js';
import type { SettingRepositoryPort } from '../../domain/setting.repository.port.js';

/**
 * APPLICATION — the whole config, typed and cached. Backs `SettingsReadContract`.
 *
 * Never throws on bad stored data. A row that no longer parses is logged and the default is used
 * instead, because this sits under every fare calculation and a 500 here takes the product down
 * over a value someone edited in a Mongo shell.
 */
export class GetSettingsSnapshotUseCase {
  constructor(private readonly settings: SettingRepositoryPort) {}

  async execute(): Promise<SettingsSnapshot> {
    const overrides = await this.settings.findOverrides();
    return buildSnapshot(overrides, (key, value) => {
      logger.warn({ key, value }, 'stored setting failed its schema — falling back to the default');
    });
  }
}
