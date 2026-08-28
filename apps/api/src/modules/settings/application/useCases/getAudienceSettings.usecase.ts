import type { SettingAudience, SettingValue } from '@driverzone/contracts';
import { filterForAudience, resolveAll } from '../../domain/setting.entity.js';
import type { SettingRepositoryPort } from '../../domain/setting.repository.port.js';

/**
 * APPLICATION — what a customer or driver app may read.
 *
 * The filter is the registry's `audiences` field, so disclosure is decided once, next to the
 * setting, rather than by whoever writes the next endpoint. A customer must be able to see every
 * fee they can be charged before they are charged it (docs/LLD/booking-lifecycle.md); a driver
 * must not be able to read the customer-facing fee ladder, and vice versa.
 */
export class GetAudienceSettingsUseCase {
  constructor(private readonly settings: SettingRepositoryPort) {}

  async execute(audience: SettingAudience): Promise<Record<string, SettingValue>> {
    const overrides = await this.settings.findOverrides();
    return filterForAudience(resolveAll(overrides), audience);
  }
}
