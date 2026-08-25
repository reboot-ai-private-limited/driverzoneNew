import { z } from 'zod';
import { bearerAuth, errorResponse, registry, successResponse } from '@/shared/http/swagger.util.js';
import {
  coverageCheckQuerySchema,
  createZoneSchema,
  listZonesQuerySchema,
  objectIdString,
  polygonGeometry,
  updateZoneGeometrySchema,
  updateZoneMetadataSchema,
  validateZoneSchema,
} from './zones.validation.js';

/**
 * INTERFACE — OpenAPI paths for the zones module, generated from the exact schemas
 * `zones.validation.ts` already validates requests with (`swagger.util.ts` explains why that
 * matters). Response DTOs below mirror `@driverzone/contracts`'s `zones.ts` field-for-field —
 * those are hand-written TypeScript interfaces, not Zod, so this is the one place their shape is
 * re-declared; if `zones.ts` changes, this file needs the matching edit (there is no compile-time
 * drift guard for these the way `zones.typecheck.ts` guards the request side).
 */

// ─── Response DTOs — mirror @driverzone/contracts/src/zones.ts ────────────────────────────────

const zoneDtoSchema = z.object({
  id: z.string(),
  type: z.enum(['CITY', 'PICKUP', 'HILL']),
  name: z.string(),
  code: z.string(),
  parent_zone_id: z.string().nullable(),
  geometry: polygonGeometry,
  priority: z.number(),
  pickup_charge_type: z.enum(['FREE', 'PAID']).optional(),
  pickup_charge_paise: z.number().nullable().optional(),
  version: z.number(),
  is_active: z.boolean(),
});

const zoneViolationDtoSchema = z.object({
  rule: z.string(),
  severity: z.enum(['ERROR', 'WARN', 'INFO']),
  message: z.string(),
  offendingGeometry: polygonGeometry.optional(),
});

const validateZoneResponseSchema = z.object({
  valid: z.boolean(),
  violations: z.array(zoneViolationDtoSchema),
  stats: z.object({ area_km2: z.number(), vertex_count: z.number() }),
});

const listZonesResponseSchema = z.object({ zones: z.array(zoneDtoSchema) });
const zoneDependentsResponseSchema = z.object({ warnings: z.array(z.string()) });
const deleteZoneResponseSchema = z.object({ deleted: z.literal(true) });
const coverageCheckResponseSchema = z.object({
  covered: z.boolean(),
  city: zoneDtoSchema.nullable(),
  pickup: zoneDtoSchema.nullable(),
});

const idParams = z.object({ id: objectIdString.openapi({ description: 'Zone id' }) });

// ─── Shared error response entries ─────────────────────────────────────────────────────────────

const jsonError = { content: { 'application/json': { schema: errorResponse } } };
const notFound = { description: 'Zone not found', ...jsonError };
const unauthenticated = { description: 'Missing or invalid bearer token', ...jsonError };
const forbidden = { description: 'Valid token, wrong role', ...jsonError };

export function registerZonesSwaggerPaths(): void {
  registry.registerPath({
    method: 'get',
    path: '/admin/zones',
    tags: ['Zones'],
    summary: 'List zones',
    security: bearerAuth,
    request: { query: listZonesQuerySchema },
    responses: {
      200: { description: 'Zones', content: { 'application/json': { schema: successResponse(listZonesResponseSchema) } } },
      401: unauthenticated,
      403: forbidden,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/admin/zones',
    tags: ['Zones'],
    summary: 'Create a zone',
    security: bearerAuth,
    request: { body: { content: { 'application/json': { schema: createZoneSchema } } } },
    responses: {
      201: { description: 'Zone created', content: { 'application/json': { schema: successResponse(zoneDtoSchema) } } },
      401: unauthenticated,
      403: forbidden,
      409: { description: 'Zone code already in use (ZONE_CODE_TAKEN)', ...jsonError },
      422: { description: 'Geometry fails validation (ZONE_VALIDATION_FAILED) — Z-2/Z-3/Z-MIN-AREA/Z-MAX-AREA', ...jsonError },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/admin/zones/validate',
    tags: ['Zones'],
    summary: 'Dry-run validate a geometry',
    description: 'Always 200 — a violation is a valid answer, not an error. Same check the write path runs for real.',
    security: bearerAuth,
    request: { body: { content: { 'application/json': { schema: validateZoneSchema } } } },
    responses: {
      200: { description: 'Validation result', content: { 'application/json': { schema: successResponse(validateZoneResponseSchema) } } },
      401: unauthenticated,
      403: forbidden,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/zones/{id}',
    tags: ['Zones'],
    summary: 'Get a zone',
    security: bearerAuth,
    request: { params: idParams },
    responses: {
      200: { description: 'Zone', content: { 'application/json': { schema: successResponse(zoneDtoSchema) } } },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/admin/zones/{id}',
    tags: ['Zones'],
    summary: 'Update zone metadata',
    description: 'Name, code, priority, pickup charge — never geometry or version. See PATCH /{id}/geometry for that.',
    security: bearerAuth,
    request: { params: idParams, body: { content: { 'application/json': { schema: updateZoneMetadataSchema } } } },
    responses: {
      200: { description: 'Zone updated', content: { 'application/json': { schema: successResponse(zoneDtoSchema) } } },
      400: { description: 'PICKUP requires a charge type, or a non-PICKUP zone was given one', ...jsonError },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: { description: 'Zone code already in use (ZONE_CODE_TAKEN)', ...jsonError },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/admin/zones/{id}/geometry',
    tags: ['Zones'],
    summary: 'Edit zone geometry (versioned)',
    description: 'Z-5: writes a new version rather than mutating in place. expected_version must match the zone\'s current version.',
    security: bearerAuth,
    request: { params: idParams, body: { content: { 'application/json': { schema: updateZoneGeometrySchema } } } },
    responses: {
      200: {
        description: 'New version saved',
        content: { 'application/json': { schema: successResponse(zoneDtoSchema) } },
      },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: { description: 'expected_version is stale, or the zone is already inactive (ZONE_ALREADY_SUPERSEDED)', ...jsonError },
      422: { description: 'Geometry fails validation (ZONE_VALIDATION_FAILED)', ...jsonError },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/admin/zones/{id}',
    tags: ['Zones'],
    summary: 'Deactivate a zone (soft, reversible)',
    description: 'Unconditionally allowed — blocks on nothing. Idempotent if already inactive.',
    security: bearerAuth,
    request: { params: idParams },
    responses: {
      200: { description: 'Zone deactivated', content: { 'application/json': { schema: successResponse(zoneDtoSchema) } } },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/admin/zones/{id}/hard',
    tags: ['Zones'],
    summary: 'Permanently delete a zone',
    description: 'Irreversible. Blocked unless the zone is already inactive — deactivate it first via DELETE /{id}.',
    security: bearerAuth,
    request: { params: idParams },
    responses: {
      200: { description: 'Zone deleted', content: { 'application/json': { schema: successResponse(deleteZoneResponseSchema) } } },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: { description: 'Zone is still active — deactivate it first (ZONE_STILL_ACTIVE)', ...jsonError },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/zones/{id}/dependents',
    tags: ['Zones'],
    summary: 'Blast-radius warnings before deactivating',
    description: 'Informational only — never blocks. E.g. "this is the only active pickup zone."',
    security: bearerAuth,
    request: { params: idParams },
    responses: {
      200: { description: 'Dependents', content: { 'application/json': { schema: successResponse(zoneDependentsResponseSchema) } } },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/coverage/check',
    tags: ['Zones'],
    summary: 'Pre-flight coverage check',
    description: 'Unauthenticated — runs before a customer has typed a destination. covered reflects PICKUP-zone membership only.',
    request: { query: coverageCheckQuerySchema },
    responses: {
      200: { description: 'Coverage', content: { 'application/json': { schema: successResponse(coverageCheckResponseSchema) } } },
      422: { description: 'lat/lng implausible for India — likely a swap (INVALID_COORDINATE)', ...jsonError },
    },
  });
}
