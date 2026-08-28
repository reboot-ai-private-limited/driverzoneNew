import { z } from 'zod';
import { bearerAuth, errorResponse, registry, successResponse } from '@/shared/http/swagger.util.js';
import {
  createIncityPackageSchema,
  createOutstationPackageSchema,
  listOutstationQuerySchema,
  listPackagesQuerySchema,
  packageIdParamSchema,
  updateIncityPackageSchema,
  updateOutstationPackageSchema,
} from './packages.validation.js';

/**
 * INTERFACE — OpenAPI paths for the packages module, generated from the exact schemas
 * `packages.validation.ts` already validates requests with (`swagger.util.ts` explains why that
 * matters). Response DTOs below mirror `@driverzone/contracts`'s `packages.ts` field-for-field —
 * those are hand-written TypeScript interfaces, not Zod, so this is the one place their shape is
 * re-declared.
 */

// ─── Response DTOs — mirror @driverzone/contracts/src/packages.ts ─────────────────────────────

const commissionType = z.enum(['PERCENT', 'FLAT']);

const incityPriceDtoSchema = z.object({
  car_category_id: z.string(),
  base_fare_paise: z.number(),
  extra_minute_rate_paise: z.number(),
  extra_km_rate_paise: z.number(),
  driver_commission_type: commissionType,
  driver_commission_value: z.number(),
  company_commission_type: commissionType,
  company_commission_value: z.number(),
  is_active: z.boolean(),
});

const incityVariantDtoSchema = z.object({
  label: z.string(),
  included_minutes: z.number(),
  included_km: z.number(),
  enforce_drop_in_city: z.boolean(),
  prices: z.array(incityPriceDtoSchema),
  sort_order: z.number(),
  is_active: z.boolean(),
});

const incityPackageDtoSchema = z.object({
  id: z.string(),
  city_zone_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  variants: z.array(incityVariantDtoSchema),
  is_active: z.boolean(),
});

const outstationPriceDtoSchema = z.object({
  car_category_id: z.string(),
  direction: z.enum(['ONE_WAY', 'ROUND_TRIP']),
  base_fare_paise: z.number(),
  extra_km_rate_paise: z.number(),
  driver_allowance_paise: z.number(),
  driver_commission_type: commissionType,
  driver_commission_value: z.number(),
  company_commission_type: commissionType,
  company_commission_value: z.number(),
  is_active: z.boolean(),
});

const outstationPackageDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  terrain: z.enum(['PLAIN', 'HILL']),
  min_km: z.number(),
  max_km: z.number(),
  prices: z.array(outstationPriceDtoSchema),
  is_active: z.boolean(),
});

const listIncityResponseSchema = z.object({ packages: z.array(incityPackageDtoSchema) });
const listOutstationResponseSchema = z.object({ packages: z.array(outstationPackageDtoSchema) });

const idParams = z.object({
  id: packageIdParamSchema.shape.id.openapi({ description: 'Package id' }),
});

// ─── Shared error response entries ─────────────────────────────────────────────────────────────

const jsonError = { content: { 'application/json': { schema: errorResponse } } };
const notFound = { description: 'Package not found', ...jsonError };
const unauthenticated = { description: 'Missing or invalid bearer token', ...jsonError };
const forbidden = { description: 'Valid token, wrong role', ...jsonError };

export function registerPackagesSwaggerPaths(): void {
  registry.registerPath({
    method: 'get',
    path: '/admin/packages/incity',
    tags: ['Packages'],
    summary: 'List InCity packages',
    security: bearerAuth,
    request: { query: listPackagesQuerySchema },
    responses: {
      200: { description: 'InCity packages', content: { 'application/json': { schema: successResponse(listIncityResponseSchema) } } },
      401: unauthenticated,
      403: forbidden,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/admin/packages/incity',
    tags: ['Packages'],
    summary: 'Create an InCity package',
    security: bearerAuth,
    request: { body: { content: { 'application/json': { schema: createIncityPackageSchema } } } },
    responses: {
      201: { description: 'Package created', content: { 'application/json': { schema: successResponse(incityPackageDtoSchema) } } },
      401: unauthenticated,
      403: forbidden,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/packages/incity/{id}',
    tags: ['Packages'],
    summary: 'Get an InCity package',
    security: bearerAuth,
    request: { params: idParams },
    responses: {
      200: { description: 'InCity package', content: { 'application/json': { schema: successResponse(incityPackageDtoSchema) } } },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/admin/packages/incity/{id}',
    tags: ['Packages'],
    summary: 'Update an InCity package',
    security: bearerAuth,
    request: { params: idParams, body: { content: { 'application/json': { schema: updateIncityPackageSchema } } } },
    responses: {
      200: { description: 'Package updated', content: { 'application/json': { schema: successResponse(incityPackageDtoSchema) } } },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/packages/outstation',
    tags: ['Packages'],
    summary: 'List Outstation packages',
    security: bearerAuth,
    request: { query: listOutstationQuerySchema },
    responses: {
      200: { description: 'Outstation packages', content: { 'application/json': { schema: successResponse(listOutstationResponseSchema) } } },
      401: unauthenticated,
      403: forbidden,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/admin/packages/outstation',
    tags: ['Packages'],
    summary: 'Create an Outstation package',
    security: bearerAuth,
    request: { body: { content: { 'application/json': { schema: createOutstationPackageSchema } } } },
    responses: {
      201: { description: 'Package created', content: { 'application/json': { schema: successResponse(outstationPackageDtoSchema) } } },
      401: unauthenticated,
      403: forbidden,
      409: { description: 'Band overlaps with another package (PACKAGE_BAND_OVERLAP)', ...jsonError },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/admin/packages/outstation/{id}',
    tags: ['Packages'],
    summary: 'Get an Outstation package',
    security: bearerAuth,
    request: { params: idParams },
    responses: {
      200: { description: 'Outstation package', content: { 'application/json': { schema: successResponse(outstationPackageDtoSchema) } } },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/admin/packages/outstation/{id}',
    tags: ['Packages'],
    summary: 'Update an Outstation package',
    security: bearerAuth,
    request: { params: idParams, body: { content: { 'application/json': { schema: updateOutstationPackageSchema } } } },
    responses: {
      200: { description: 'Package updated', content: { 'application/json': { schema: successResponse(outstationPackageDtoSchema) } } },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: { description: 'Band overlaps with another package (PACKAGE_BAND_OVERLAP)', ...jsonError },
    },
  });
}
