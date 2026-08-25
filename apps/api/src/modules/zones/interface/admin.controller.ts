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
import type { UpdateZoneMetadataUseCase } from '../application/useCases/updateZoneMetadata.usecase.js';
import type { ValidateZoneGeometryUseCase } from '../application/useCases/validateZoneGeometry.usecase.js';
import type { DeactivateZoneUseCase } from '../application/useCases/deactivateZone.usecase.js';
import type { DeleteZoneUseCase } from '../application/useCases/deleteZone.usecase.js';
import type { GetZoneDependentsUseCase } from '../application/useCases/getZoneDependents.usecase.js';
import type { ListZonesUseCase } from '../application/useCases/listZones.usecase.js';
import type { GetZoneUseCase } from '../application/useCases/getZone.usecase.js';
import { zoneToDto, violationToDto } from './zoneDto.mapper.js';
import {
  createZoneSchema,
  listZonesQuerySchema,
  updateZoneGeometrySchema,
  updateZoneMetadataSchema,
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
  updateMetadata: UpdateZoneMetadataUseCase;
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
  updateMetadata: RequestHandler;
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
          geometry: input.geometry,
          priority: input.priority,
          pickupChargeType: input.pickup_charge_type,
          pickupChargePaise: input.pickup_charge_paise ?? undefined,
        },
        { adminId: actorId(req), ip: req.ip },
      );
      sendSuccess(req, res, zoneToDto(zone), `Zone saved as version ${zone.version}.`, 201);
    }),

    updateGeometry: asyncHandler(async (req, res) => {
      const input = updateZoneGeometrySchema.parse(req.body);
      const zone = await deps.updateGeometry.execute(
        req.params['id'] ?? '',
        { geometry: input.geometry, expectedVersion: input.expected_version },
        { adminId: actorId(req), ip: req.ip },
      );
      sendSuccess(req, res, zoneToDto(zone), `Zone saved as version ${zone.version}.`);
    }),

    updateMetadata: asyncHandler(async (req, res) => {
      const input = updateZoneMetadataSchema.parse(req.body);
      const zone = await deps.updateMetadata.execute(
        req.params['id'] ?? '',
        {
          name: input.name,
          code: input.code,
          priority: input.priority,
          pickupChargeType: input.pickup_charge_type,
          pickupChargePaise: input.pickup_charge_paise,
        },
        { adminId: actorId(req), ip: req.ip },
      );
      sendSuccess(req, res, zoneToDto(zone), 'Zone updated');
    }),

    // DELETE /admin/zones/:id — soft, reversible. Blocks on nothing.
    deactivate: asyncHandler(async (req, res) => {
      const zone = await deps.deactivate.execute(req.params['id'] ?? '', {
        adminId: actorId(req),
        ip: req.ip,
      });
      sendSuccess(req, res, zoneToDto(zone), 'Zone deactivated');
    }),

    // DELETE /admin/zones/:id/hard — permanent. Blocked unless already inactive.
    delete: asyncHandler(async (req, res) => {
      await deps.delete.execute(req.params['id'] ?? '', { adminId: actorId(req), ip: req.ip });
      const body: DeleteZoneResponse = { deleted: true };
      sendSuccess(req, res, body, 'Zone deleted');
    }),

    // Always 200 — a violation is a valid answer, not a 422 (docs/LLD/zones.md).
    validate: asyncHandler(async (req, res) => {
      const input = validateZoneSchema.parse(req.body);
      const result = await deps.validate.execute({
        type: input.type,
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
      const body: ZoneDependentsResponse = { warnings: result.warnings };
      sendSuccess(req, res, body, 'Zone dependents');
    }),
  };
}
