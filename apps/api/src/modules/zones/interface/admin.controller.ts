import type { Request, RequestHandler } from 'express';
import type {
  DeleteZoneResponse,
  ListZonesResponse,
  ValidateZoneResponse,
  ZoneDependentsResponse,
} from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { CreateZoneUseCase } from '../application/useCases/createZone.usecase.js';
import type { UpdateZoneGeometryUseCase } from '../application/useCases/updateZoneGeometry.usecase.js';
import type { ValidateZoneGeometryUseCase } from '../application/useCases/validateZoneGeometry.usecase.js';
import type { DeactivateZoneUseCase } from '../application/useCases/deactivateZone.usecase.js';
import type { DeleteZoneUseCase } from '../application/useCases/deleteZone.usecase.js';
import type { GetZoneDependentsUseCase } from '../application/useCases/getZoneDependents.usecase.js';
import type { ListZonesUseCase } from '../application/useCases/listZones.usecase.js';
import type { GetZoneUseCase } from '../application/useCases/getZone.usecase.js';
import { zoneToDto, violationToDto } from './zoneDto.mapper.js';
import {
  createZoneSchema,
  deactivateZoneSchema,
  listZonesQuerySchema,
  updateZoneGeometrySchema,
  validateZoneSchema,
} from './zones.validation.js';

/** INTERFACE — zone CRUD, validation, and lifecycle. Every route here is `requireAuth('ADMIN')`. */

function actorId(req: Request): string {
  const id = req.principal?.sub;
  if (id === undefined) throw AppError.unauthenticated();
  return id;
}

export interface AdminControllerDeps {
  create: CreateZoneUseCase;
  updateGeometry: UpdateZoneGeometryUseCase;
  validate: ValidateZoneGeometryUseCase;
  deactivate: DeactivateZoneUseCase;
  delete: DeleteZoneUseCase;
  getDependents: GetZoneDependentsUseCase;
  list: ListZonesUseCase;
  get: GetZoneUseCase;
}

export interface AdminControllers {
  list: RequestHandler;
  get: RequestHandler;
  create: RequestHandler;
  updateGeometry: RequestHandler;
  deactivate: RequestHandler;
  delete: RequestHandler;
  validate: RequestHandler;
  getDependents: RequestHandler;
}

export function makeAdminControllers(deps: AdminControllerDeps): AdminControllers {
  return {
    list: asyncHandler(async (req, res) => {
      const q = listZonesQuerySchema.parse(req.query);
      const zones = await deps.list.execute({
        ...(q.type === undefined ? {} : { type: q.type }),
        ...(q.parent_zone_id === undefined ? {} : { parentZoneId: q.parent_zone_id }),
        ...(q.is_active === undefined ? {} : { isActive: q.is_active }),
      });
      const body: ListZonesResponse = { zones: zones.map(zoneToDto) };
      sendSuccess(req, res, body, 'Zones');
    }),

    get: asyncHandler(async (req, res) => {
      const zone = await deps.get.execute(req.params['id'] ?? '');
      sendSuccess(req, res, zoneToDto(zone), 'Zone');
    }),

    create: asyncHandler(async (req, res) => {
      const input = createZoneSchema.parse(req.body);
      const zone = await deps.create.execute(
        {
          type: input.type,
          name: input.name,
          code: input.code,
          parentZoneId: input.parent_zone_id,
          geometry: input.geometry,
          priority: input.priority,
          pickupChargeType: input.pickup_charge_type,
          pickupChargePaise: input.pickup_charge_paise ?? undefined,
        },
        { adminId: actorId(req), ip: req.ip },
      );
      sendSuccess(req, res, zoneToDto(zone), 'Zone created', 201);
    }),

    updateGeometry: asyncHandler(async (req, res) => {
      const input = updateZoneGeometrySchema.parse(req.body);
      const zone = await deps.updateGeometry.execute(
        req.params['id'] ?? '',
        { geometry: input.geometry },
        { adminId: actorId(req), ip: req.ip },
      );
      sendSuccess(req, res, zoneToDto(zone), 'Zone updated');
    }),

    deactivate: asyncHandler(async (req, res) => {
      const input = deactivateZoneSchema.parse(req.body);
      const zone = await deps.deactivate.execute(
        req.params['id'] ?? '',
        { force: input.force },
        { adminId: actorId(req), ip: req.ip },
      );
      sendSuccess(req, res, zoneToDto(zone), 'Zone deactivated');
    }),

    delete: asyncHandler(async (req, res) => {
      await deps.delete.execute(req.params['id'] ?? '', { adminId: actorId(req), ip: req.ip });
      const body: DeleteZoneResponse = { deleted: true };
      sendSuccess(req, res, body, 'Zone deleted');
    }),

    validate: asyncHandler(async (req, res) => {
      const input = validateZoneSchema.parse(req.body);
      const result = await deps.validate.execute({
        type: input.type,
        parentZoneId: input.parent_zone_id,
        geometry: input.geometry,
        excludeZoneId: input.exclude_zone_id,
      });
      const body: ValidateZoneResponse = {
        valid: result.valid,
        violations: result.violations.map(violationToDto),
        stats: { area_km2: result.stats.areaKm2, vertex_count: result.stats.vertexCount },
      };
      sendSuccess(req, res, body, 'Validation result');
    }),

    getDependents: asyncHandler(async (req, res) => {
      const result = await deps.getDependents.execute(req.params['id'] ?? '');
      const body: ZoneDependentsResponse = {
        child_pickup_zones: result.childPickupZones.map(zoneToDto),
      };
      sendSuccess(req, res, body, 'Zone dependents');
    }),
  };
}
