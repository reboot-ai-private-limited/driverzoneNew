import type { Request, RequestHandler } from 'express';
import type { AdminUserDto, AdminUserListDto } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { AdminRosterEntry } from '../domain/adminRoster.repository.port.js';
import type { ManageAdminsUseCase } from '../application/useCases/manageAdmins.usecase.js';
import {
  adminIdParamSchema,
  createAdminUserSchema,
  updateAdminUserSchema,
} from './identity.validation.js';

/**
 * INTERFACE — `/admin/admins`, the roster a SUPER_ADMIN manages.
 *
 * The acting admin comes from `req.principal` and never from the request: it is who every audit
 * row is attributed to, and it is what the "not yourself" rules compare against.
 */

function actor(req: Request): { adminId: string; ip: string | undefined } {
  const adminId = req.principal?.sub;
  if (adminId === undefined) throw AppError.unauthenticated();
  return { adminId, ip: req.ip };
}

function toDto(entry: AdminRosterEntry): AdminUserDto {
  return {
    id: entry.id,
    mobile_number: entry.mobileNumber,
    full_name: entry.fullName,
    admin_role: entry.adminRole,
    is_active: entry.isActive,
    created_at: entry.createdAt.toISOString(),
    deactivated_at: entry.deactivatedAt === null ? null : entry.deactivatedAt.toISOString(),
  };
}

export interface AdminRosterControllers {
  list: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
  deactivate: RequestHandler;
  reactivate: RequestHandler;
}

export function makeAdminRosterControllers(admins: ManageAdminsUseCase): AdminRosterControllers {
  return {
    list: asyncHandler(async (req, res) => {
      const body: AdminUserListDto = { admins: (await admins.list()).map(toDto) };
      sendSuccess(req, res, body, 'Admins');
    }),

    create: asyncHandler(async (req, res) => {
      const input = createAdminUserSchema.parse(req.body);
      const created = await admins.create(
        { phone: input.mobile_number, fullName: input.full_name, adminRole: input.admin_role },
        actor(req),
      );
      sendSuccess(req, res, toDto(created), 'Admin added', 201);
    }),

    update: asyncHandler(async (req, res) => {
      const { id } = adminIdParamSchema.parse(req.params);
      const input = updateAdminUserSchema.parse(req.body);
      const updated = await admins.update(
        id,
        {
          ...(input.full_name === undefined ? {} : { fullName: input.full_name }),
          ...(input.admin_role === undefined ? {} : { adminRole: input.admin_role }),
        },
        actor(req),
      );
      sendSuccess(req, res, toDto(updated), 'Admin updated');
    }),

    deactivate: asyncHandler(async (req, res) => {
      const { id } = adminIdParamSchema.parse(req.params);
      sendSuccess(req, res, toDto(await admins.setActive(id, false, actor(req))), 'Admin deactivated');
    }),

    reactivate: asyncHandler(async (req, res) => {
      const { id } = adminIdParamSchema.parse(req.params);
      sendSuccess(req, res, toDto(await admins.setActive(id, true, actor(req))), 'Admin reactivated');
    }),
  };
}
