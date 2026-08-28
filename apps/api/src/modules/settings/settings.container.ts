import type { Router } from 'express';
import type { Role } from '@driverzone/contracts';
import type { SettingsPublicContract } from './settings.public.js';
import { MongoSettingRepository } from './infrastructure/setting.repository.impl.js';
import { CachedSettingRepository } from './infrastructure/cachedSetting.repository.js';
import { SettingsAuditLog } from './infrastructure/audit.settings.js';
import { GetSettingsSnapshotUseCase } from './application/useCases/getSettingsSnapshot.usecase.js';
import { ListSettingsUseCase } from './application/useCases/listSettings.usecase.js';
import { UpdateSettingsUseCase } from './application/useCases/updateSettings.usecase.js';
import { ResetSettingsUseCase } from './application/useCases/resetSettings.usecase.js';
import { GetAudienceSettingsUseCase } from './application/useCases/getAudienceSettings.usecase.js';
import {
  makeAudienceSettingsController,
  makeListSettingsController,
  makeResetSettingsController,
  makeUpdateSettingsController,
} from './interface/settings.controller.js';
import { buildAdminRouter, buildAudienceRouter } from './interface/settings.routes.js';
import { registerSettingsSwaggerPaths } from './interface/settings.swagger.js';

export interface SettingsContainer {
  contract: SettingsPublicContract;
  buildAdminRouter: () => Router;
  buildAudienceRouter: (role: Extract<Role, 'CUSTOMER' | 'DRIVER'>) => Router;
}

export function buildSettingsContainer(): SettingsContainer {
  /**
   * ONE cache instance, shared by every use case in this container — including the write ones.
   * That is the point: a write invalidates the same cache the next read consults, so an admin
   * who saves a change and reloads the page sees it, rather than the old value for up to a
   * minute. The alternative (caching only the read path) is a bug report nobody can reproduce.
   */
  const repo = new CachedSettingRepository(new MongoSettingRepository());
  const audit = new SettingsAuditLog();

  const snapshot = new GetSettingsSnapshotUseCase(repo);
  const list = new ListSettingsUseCase(repo);
  const update = new UpdateSettingsUseCase(repo, audit);
  const reset = new ResetSettingsUseCase(repo, audit);
  const audience = new GetAudienceSettingsUseCase(repo);

  registerSettingsSwaggerPaths();

  return {
    contract: {
      snapshot: () => snapshot.execute(),
      get: async (key) => (await snapshot.execute())[key],
    },
    buildAdminRouter: () =>
      buildAdminRouter({
        list: makeListSettingsController(list),
        update: makeUpdateSettingsController(update),
        reset: makeResetSettingsController(reset),
      }),
    buildAudienceRouter: (role) =>
      buildAudienceRouter(role, makeAudienceSettingsController(audience, role)),
  };
}
