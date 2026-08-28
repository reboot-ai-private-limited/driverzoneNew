import { z } from 'zod';
import { TERRAINS } from '@driverzone/contracts';
import type { Terrain } from '@driverzone/geo';

/**
 * INTERFACE — the boundary. Nothing past this file re-validates
 * (docs/engineering/coding-standards.md §Validation).
 *
 * Field names here mirror the Mongoose schemas in `docs/LLD/database-schema.md` rather than the
 * snake_case the RESPONSE DTOs use. That asymmetry is still not a decision anyone would make
 * twice, but it is no longer unguarded: `packages.typecheck.ts` pins every schema below to the
 * matching request type in @driverzone/contracts, so the two can no longer drift in silence.
 * Aligning the request bodies onto snake_case is a separate change with its own caller migration.
 */

/** Money is integer paise, everywhere, without exception (coding-standards.md §Money). */
const paise = z.number().int().min(0);

/**
 * The DRIVER's share, in basis points — 7500 is 75%, and 10000 is the whole fare.
 *
 * The company's share is not a field: it is `10000 - this`. The old shape stored both sides with
 * their own PERCENT/FLAT type, which let a form save 75% and 20% and leave 5% of every trip
 * unallocated — a cross-field `superRefine` used to guard half of that and could not guard the
 * rest. One bounded integer removes the failure mode instead of validating it.
 */
const commissionBps = z.number().int().min(0).max(10000);

/**
 * `@driverzone/geo` exports `Terrain` as a bare type alias with no runtime companion, so the
 * literals live in @driverzone/contracts where the web app can reach them too. This is the pin
 * that stops that copy drifting into something `Terrain` does not accept.
 */
const _terrainsMatchGeo = TERRAINS satisfies readonly Terrain[];
void _terrainsMatchGeo;

// ─── InCity ────────────────────────────────────────────────────────────────────────────────

/**
 * A duration and a price. Zod strips unknown keys by default, so a caller still sending
 * `includedKm` or `extraKmRatePaise` gets them dropped rather than honoured — which is the right
 * failure for a field that no longer means anything.
 */
const incityVariantSchema = z.object({
  label: z.string().min(1),
  includedMinutes: z.number().int().min(1),
  baseFarePaise: paise,
  driverCommissionBps: commissionBps,
  isActive: z.boolean().optional().default(true),
});

export const createIncityPackageSchema = z.object({
  cityZoneId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  variants: z.array(incityVariantSchema).min(1),
  isActive: z.boolean().optional().default(true),
});

// ─── Outstation ────────────────────────────────────────────────────────────────────────────

export const createOutstationPackageSchema = z.object({
  name: z.string().min(1).max(200),
  terrain: z.enum(TERRAINS),
  minKm: z.number().int().min(0),
  /** Bands are half-open `[minKm, maxKm)`, so `maxKm` must clear `minKm`. P-4 rechecks it. */
  maxKm: z.number().int().min(1),
  oneWayFarePaise: paise,
  /**
   * The fare for the whole two-way journey, not capped to same-day.
   *
   * `null` — or absent — means this band does not sell a return trip. NOT zero: `.nullable()`
   * rather than `.default(0)` is the whole point, because a free return trip and an unavailable
   * one must not be the same value (docs/LLD/packages.md §Outstation is priced per direction).
   */
  roundTripFarePaise: paise.nullable().optional(),
  driverCommissionBps: commissionBps,
  isActive: z.boolean().optional().default(true),
});

// ─── Updates and queries ───────────────────────────────────────────────────────────────────

export const updateIncityPackageSchema = createIncityPackageSchema.partial();
export const updateOutstationPackageSchema = createOutstationPackageSchema.partial();

export const listPackagesQuerySchema = z.object({
  // Query values are strings; `z.coerce.boolean()` would read 'false' as true.
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const listOutstationQuerySchema = listPackagesQuerySchema.extend({
  terrain: z.enum(TERRAINS).optional(),
});

export const packageIdParamSchema = z.object({
  id: z.string().min(1),
});

export type CreateIncityPackageInput = z.infer<typeof createIncityPackageSchema>;
export type UpdateIncityPackageInput = z.infer<typeof updateIncityPackageSchema>;
export type CreateOutstationPackageInput = z.infer<typeof createOutstationPackageSchema>;
export type UpdateOutstationPackageInput = z.infer<typeof updateOutstationPackageSchema>;
export type ListPackagesQueryInput = z.infer<typeof listPackagesQuerySchema>;
export type ListOutstationQueryInput = z.infer<typeof listOutstationQuerySchema>;

/**
 * The BODY types — what a caller sends — as opposed to the `*Input` types above, which are what
 * the use cases receive after Zod has applied its defaults.
 *
 * The distinction matters and is easy to get wrong: `z.infer` is the OUTPUT type, in which
 * `isActive: z.boolean().optional().default(true)` is a required `boolean`. Pinning the shared
 * request type against that would tell every client it must send a field it may omit. These are
 * `z.input`, which is the shape on the wire, and they are what `packages.typecheck.ts` guards.
 */
export type CreateIncityPackageBody = z.input<typeof createIncityPackageSchema>;
export type UpdateIncityPackageBody = z.input<typeof updateIncityPackageSchema>;
export type CreateOutstationPackageBody = z.input<typeof createOutstationPackageSchema>;
export type UpdateOutstationPackageBody = z.input<typeof updateOutstationPackageSchema>;
