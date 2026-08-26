import { z } from 'zod';
import { ZONE_TYPES } from '@driverzone/contracts';

/**
 * INTERFACE — Zod at the boundary, per docs/engineering/coding-standards.md.
 *
 * Zone geometry crosses the wire as raw GeoJSON `Polygon` (`[lng, lat]` order per ring point),
 * not `{lat, lng}` — the one deliberate exception to this API's usual coordinate convention. A
 * polygon drawn in the admin map editor is already GeoJSON on the client; `@driverzone/geo`'s
 * `{lat,lng}` conversion helpers exist for single points, not for hand-editing an entire ring.
 */

const zoneName = z.string().trim().min(1).max(120);
const zoneCode = z.string().trim().min(1).max(40);
/** Exported: `zones.swagger.ts` reuses this for the `{id}` path param — one definition, not two. */
export const objectIdString = z.string().trim().min(1);

// geojson's `Position` is `number[]`, not a fixed tuple (it deliberately allows an optional
// third/elevation element) — matching that exactly here is what lets `zones.typecheck.ts`
// compare this schema's inferred type against `Polygon` from `@driverzone/contracts` without a
// spurious mismatch. `.min(2)` still requires at least [lng, lat].
const position = z.array(z.number()).min(2);
/** A closed ring needs at least three distinct corners plus the point that closes it. */
const ring = z.array(position).min(4);
/** Exported: `zones.swagger.ts` reuses this for response DTOs too — the docs describe the real shape. */
export const polygonGeometry = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(ring).min(1),
});

/** Query strings are always text — `"false"` is truthy to `Boolean()`, so this is not optional. */
const queryBoolean = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

// ─── Zone CRUD ──────────────────────────────────────────────────────────────────────────────
// No `parent_zone_id` anywhere below — Z-1 is retired, nothing supplies one any more
// (docs/LLD/zones.md, docs/decision-log.md).

export const createZoneSchema = z.object({
  type: z.enum(ZONE_TYPES),
  name: zoneName,
  code: zoneCode,
  geometry: polygonGeometry,
  priority: z.number().int().optional(),
  pickup_charge_type: z.enum(['FREE', 'PAID']).optional(),
  pickup_charge_paise: z.number().int().min(0).nullable().optional(),
});

export const updateZoneGeometrySchema = z.object({
  geometry: polygonGeometry,
  expected_version: z.number().int().min(1),
});

export const updateZoneMetadataSchema = z.object({
  name: zoneName.optional(),
  code: zoneCode.optional(),
  priority: z.number().int().optional(),
  pickup_charge_type: z.enum(['FREE', 'PAID']).nullable().optional(),
  pickup_charge_paise: z.number().int().min(0).nullable().optional(),
});

export const validateZoneSchema = z.object({
  type: z.enum(ZONE_TYPES),
  geometry: polygonGeometry,
  exclude_zone_id: objectIdString.optional(),
});

export const listZonesQuerySchema = z.object({
  type: z.enum(ZONE_TYPES).optional(),
  is_active: queryBoolean,
});

export const coverageCheckQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
});

export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type UpdateZoneGeometryInput = z.infer<typeof updateZoneGeometrySchema>;
export type UpdateZoneMetadataInput = z.infer<typeof updateZoneMetadataSchema>;
export type ValidateZoneInput = z.infer<typeof validateZoneSchema>;
export type ListZonesQueryInput = z.infer<typeof listZonesQuerySchema>;
export type CoverageCheckQueryInput = z.infer<typeof coverageCheckQuerySchema>;
