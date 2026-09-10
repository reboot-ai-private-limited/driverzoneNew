import { z } from 'zod';
import { SETTING_GROUPS, SETTING_UNITS } from '@driverzone/contracts';
import { bearerAuth, errorResponse, registry, successResponse } from '@/shared/http/swagger.util.js';
import { SETTING_KEYS } from '../domain/setting.registry.js';
import { patchSettingsSchema, resetSettingsSchema } from './settings.validation.js';

/**
 * INTERFACE — OpenAPI paths, generated from the exact schemas `settings.validation.ts` validates
 * requests with (`swagger.util.ts` explains why that matters). Response DTOs below mirror
 * `@driverzone/contracts`'s `settings.ts` field-for-field; those are hand-written interfaces, not
 * Zod, so this is the one place their shape is re-declared.
 *
 * `SETTING_KEYS` is pulled straight from the registry, so the documented key list cannot go stale
 * — adding a setting adds it to the docs with no edit here.
 */

const settingValueSchema = z
  .union([z.number(), z.object({ start: z.string(), end: z.string() })])
  .openapi({ description: 'A whole number (rupees, minutes, seconds or a count) or an HH:mm window. Never paise.' });

const settingDtoSchema = z.object({
  key: z.string().openapi({ example: 'pricing.insurance_charge' }),
  value: settingValueSchema,
  default_value: settingValueSchema,
  is_overridden: z.boolean(),
  group: z.enum(SETTING_GROUPS),
  label: z.string(),
  unit: z.enum(SETTING_UNITS),
  /*
   * Presentation only, and absent on all but one key. The wire value stays in `unit` — a scaled
   * key is stored and validated in metres and merely SHOWN in kilometres, so a client that
   * ignores this field is still correct, only less readable.
   */
  display: z
    .object({ unit: z.enum(SETTING_UNITS), factor: z.number(), decimals: z.number().int() })
    .optional()
    .openapi({ description: 'Render in a friendlier unit: displayed = value ÷ factor.' }),
  description: z.string(),
  updated_at: z.string().nullable(),
  updated_by: z.string().nullable(),
});

const settingGroupDtoSchema = z.object({
  group: z.enum(SETTING_GROUPS),
  label: z.string(),
  settings: z.array(settingDtoSchema),
});

const getSettingsResponseSchema = z.object({ groups: z.array(settingGroupDtoSchema) });
const patchSettingsResponseSchema = z.object({ updated: z.array(z.string()) });
const resetSettingsResponseSchema = z.object({ reset: z.array(z.string()) });
const audienceSettingsResponseSchema = z.object({ settings: z.record(settingValueSchema) });

const jsonError = { content: { 'application/json': { schema: errorResponse } } };
const unauthenticated = { description: 'Missing or invalid bearer token', ...jsonError };
const forbidden = { description: 'Valid token, wrong role', ...jsonError };
const badRequest = { description: 'Unknown key, or a value that fails its own schema', ...jsonError };
const invariantFailed = {
  description: 'Values are individually valid but conflict with each other',
  ...jsonError,
};

const keyList = `Known keys: ${SETTING_KEYS.join(', ')}.`;

export function registerSettingsSwaggerPaths(): void {
  registry.registerPath({
    method: 'get',
    path: '/admin/settings',
    tags: ['Settings'],
    summary: 'List every global setting, grouped',
    description:
      'Returns all keys, whether or not they have been overridden. Money values are WHOLE RUPEES, ' +
      'not paise — the one deliberate exception to this API\'s paise convention.',
    security: bearerAuth,
    responses: {
      200: { description: 'Settings', content: { 'application/json': { schema: successResponse(getSettingsResponseSchema) } } },
      401: unauthenticated,
      403: forbidden,
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/admin/settings',
    tags: ['Settings'],
    summary: 'Update settings (all-or-nothing)',
    description:
      `A sparse map merged over what is stored. Every value is validated against its own key's rule, ` +
      `then the resulting configuration is checked for cross-key conflicts; nothing is written unless ` +
      `all of it passes. ${keyList}`,
    security: bearerAuth,
    request: { body: { content: { 'application/json': { schema: patchSettingsSchema } } } },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: successResponse(patchSettingsResponseSchema) } } },
      400: badRequest,
      401: unauthenticated,
      403: forbidden,
      422: invariantFailed,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/admin/settings/reset',
    tags: ['Settings'],
    summary: 'Revert settings to their built-in defaults',
    description: `Deletes the named overrides. Resetting a key that was never overridden is a no-op. ${keyList}`,
    security: bearerAuth,
    request: { body: { content: { 'application/json': { schema: resetSettingsSchema } } } },
    responses: {
      200: { description: 'Reset', content: { 'application/json': { schema: successResponse(resetSettingsResponseSchema) } } },
      400: badRequest,
      401: unauthenticated,
      403: forbidden,
      422: invariantFailed,
    },
  });

  for (const audience of ['customer', 'driver'] as const) {
    registry.registerPath({
      method: 'get',
      path: `/${audience}/settings`,
      tags: ['Settings'],
      summary: `Settings visible to a ${audience}`,
      description:
        'A flat key → value map, filtered by the audiences each setting declares. Keys the other ' +
        'role owns are absent, not null.',
      security: bearerAuth,
      responses: {
        200: { description: 'Settings', content: { 'application/json': { schema: successResponse(audienceSettingsResponseSchema) } } },
        401: unauthenticated,
        403: forbidden,
      },
    });
  }
}
