import { z } from 'zod';
import type { Terrain } from '@driverzone/geo';

/**
 * INTERFACE — the boundary. Nothing past this file re-validates
 * (docs/engineering/coding-standards.md §Validation).
 *
 * Field names here mirror the Mongoose schemas in `docs/LLD/database-schema.md` rather than the
 * snake_case the rest of the wire uses. That is a known gap, not a decision: this module has no
 * `packages/contracts/src/packages.ts` and therefore no `packages.typecheck.ts` drift guard yet.
 * Both land with the swagger work — see the follow-up in docs/LLD/packages.md.
 */

const commissionType = z.enum(['PERCENT', 'FLAT']);

/**
 * `@driverzone/geo` exports `Terrain` as a bare type alias with no runtime companion, so the
 * literals have to be repeated here. `satisfies` is what stops them drifting into something
 * `Terrain` does not accept.
 */
const TERRAINS = ['PLAIN', 'HILL'] as const satisfies readonly Terrain[];

/** Money is integer paise, everywhere, without exception (coding-standards.md §Money). */
const paise = z.number().int().min(0);

/**
 * Commission is basis points when the type is PERCENT — 2500 is 25%, so anything above 10000
 * is more than the whole fare. The check has to sit on the object rather than the field because
 * the cap depends on the sibling `*CommissionType`.
 *
 * Shared by both price schemas: the driver/company split is one rule, and two copies of it drift.
 */
function refineCommissionBps<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.superRefine((data, ctx) => {
    const rows = [
      ['driver', data.driverCommissionType, data.driverCommissionValue] as const,
      ['company', data.companyCommissionType, data.companyCommissionValue] as const,
    ];
    for (const [side, type, value] of rows) {
      if (type === 'PERCENT' && typeof value === 'number' && value > 10000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Percent commission cannot exceed 10000 BPS (100%).',
          path: [`${side}CommissionValue`],
        });
      }
    }
  });
}

// ─── InCity ────────────────────────────────────────────────────────────────────────────────

const incityPriceSchema = refineCommissionBps(
  z.object({
    carCategoryId: z.string().min(1),
    baseFarePaise: paise,
    extraMinuteRatePaise: paise.optional().default(0),
    extraKmRatePaise: paise.optional().default(0),
    driverCommissionType: commissionType,
    driverCommissionValue: z.number().int().min(0),
    companyCommissionType: commissionType,
    companyCommissionValue: z.number().int().min(0),
    isActive: z.boolean().optional().default(true),
  }),
);

const incityVariantSchema = z.object({
  label: z.string().min(1),
  includedMinutes: z.number().int().min(1),
  includedKm: z.number().int().min(0),
  /** Per-variant because it defaults from duration — off above 4 hours. open-questions.md Q1. */
  enforceDropInCity: z.boolean().optional().default(true),
  prices: z.array(incityPriceSchema).min(1),
  sortOrder: z.number().int().optional().default(0),
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

const outstationPriceSchema = refineCommissionBps(
  z.object({
    carCategoryId: z.string().min(1),
    /**
     * A round trip is a SEPARATE row, never a computed multiple of the one-way. The driver's
     * day differs in kind — they wait, they may get no return fare — so ops sets both
     * independently (docs/LLD/packages.md §Outstation is priced per direction).
     */
    direction: z.enum(['ONE_WAY', 'ROUND_TRIP']),
    baseFarePaise: paise,
    extraKmRatePaise: paise.optional().default(0),
    driverAllowancePaise: paise.optional().default(0),
    driverCommissionType: commissionType,
    driverCommissionValue: z.number().int().min(0),
    companyCommissionType: commissionType,
    companyCommissionValue: z.number().int().min(0),
    isActive: z.boolean().optional().default(true),
  }),
);

export const createOutstationPackageSchema = z.object({
  name: z.string().min(1).max(200),
  terrain: z.enum(TERRAINS),
  minKm: z.number().int().min(0),
  /** Bands are half-open `[minKm, maxKm)`, so `maxKm` must clear `minKm`. P-4 rechecks it. */
  maxKm: z.number().int().min(1),
  prices: z.array(outstationPriceSchema).min(1),
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
