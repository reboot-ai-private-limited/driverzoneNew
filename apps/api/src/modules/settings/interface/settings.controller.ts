import type { RequestHandler } from 'express';
import type { SettingAudience } from '@driverzone/contracts';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import { AppError } from '@/shared/errors/AppError.js';
import type { ActorContext } from '../application/actorContext.js';
import type { GetAudienceSettingsUseCase } from '../application/useCases/getAudienceSettings.usecase.js';
import type { ListSettingsUseCase } from '../application/useCases/listSettings.usecase.js';
import type { ResetSettingsUseCase } from '../application/useCases/resetSettings.usecase.js';
import type { UpdateSettingsUseCase } from '../application/useCases/updateSettings.usecase.js';
import { patchSettingsSchema, resetSettingsSchema } from './settings.validation.js';

/**
 * The admin behind a write. `requireAuth('ADMIN')` guards every route that reaches here, so a
 * missing principal is a wiring fault rather than an unauthenticated caller — hence a 500, not a
 * 401, which would tell the admin to sign in again for a problem signing in cannot fix.
 */
function actorFrom(req: Parameters<RequestHandler>[0]): ActorContext {
  const adminId = req.principal?.sub;
  if (adminId === undefined) {
    throw AppError.internal('INTERNAL', { reason: 'settings write route reached without a principal' });
  }
  return { adminId, ip: req.ip };
}

export function makeListSettingsController(useCase: ListSettingsUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const groups = await useCase.execute();
    sendSuccess(req, res, { groups }, 'Settings');
  });
}

export function makeUpdateSettingsController(useCase: UpdateSettingsUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { values } = patchSettingsSchema.parse(req.body);
    const { updated } = await useCase.execute(values, actorFrom(req));
    sendSuccess(req, res, { updated }, 'Settings updated');
  });
}

export function makeResetSettingsController(useCase: ResetSettingsUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { keys } = resetSettingsSchema.parse(req.body);
    const { reset } = await useCase.execute(keys, actorFrom(req));
    sendSuccess(req, res, { reset }, 'Settings reset to defaults');
  });
}

/**
 * One controller for both audience routes — the audience is fixed at wiring time by which router
 * mounted it, never read from the request. A caller-supplied audience would be a caller choosing
 * what they are allowed to see.
 */
export function makeAudienceSettingsController(
  useCase: GetAudienceSettingsUseCase,
  audience: SettingAudience,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const settings = await useCase.execute(audience);
    sendSuccess(req, res, { settings }, 'Settings');
  });
}
