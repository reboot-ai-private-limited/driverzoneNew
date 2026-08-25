import { z } from 'zod';

const commissionType = z.enum(['PERCENT', 'FLAT']);

const incityPriceSchema = z.object({
  carCategoryId: z.string().min(1),
  baseFarePaise: z.number().int().min(0),
  extraMinuteRatePaise: z.number().int().min(0).optional().default(0),
  extraKmRatePaise: z.number().int().min(0).optional().default(0),
  nightChargePaise: z.number().int().min(0).optional().default(0),
  driverCommissionType: commissionType,
  driverCommissionValue: z.number().int().min(0),
  companyCommissionType: commissionType,
  companyCommissionValue: z.number().int().min(0),
}).superRefine((data, ctx) => {
  if (data.driverCommissionType === 'PERCENT' && data.driverCommissionValue > 10000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Percent commission cannot exceed 10000 BPS', path: ['driverCommissionValue'] });
  }
  if (data.companyCommissionType === 'PERCENT' && data.companyCommissionValue > 10000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Percent commission cannot exceed 10000 BPS', path: ['companyCommissionValue'] });
  }
});

const incityVariantSchema = z.object({
  label: z.string().min(1),
  includedMinutes: z.number().int().min(1),
  includedKm: z.number().int().min(0),
  enforceDropInCity: z.boolean().optional().default(true),
  prices: z.array(incityPriceSchema).min(1),
  sortOrder: z.number().int().optional().default(0),
});

export const createIncityPackageSchema = z.object({
  cityZoneId: z.string().min(1),
  pickupZoneIds: z.array(z.string().min(1)).min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  variants: z.array(incityVariantSchema).min(1),
  isActive: z.boolean().optional().default(true),
});

const outstationPriceSchema = z.object({
  carCategoryId: z.string().min(1),
  direction: z.enum(['ONE_WAY', 'ROUND_TRIP']),
  baseFarePaise: z.number().int().min(0),
  extraKmRatePaise: z.number().int().min(0).optional().default(0),
  driverAllowancePaise: z.number().int().min(0).optional().default(0),
  driverCommissionType: commissionType,
  driverCommissionValue: z.number().int().min(0),
  companyCommissionType: commissionType,
  companyCommissionValue: z.number().int().min(0),
}).superRefine((data, ctx) => {
  if (data.driverCommissionType === 'PERCENT' && data.driverCommissionValue > 10000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Percent commission cannot exceed 10000 BPS', path: ['driverCommissionValue'] });
  }
  if (data.companyCommissionType === 'PERCENT' && data.companyCommissionValue > 10000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Percent commission cannot exceed 10000 BPS', path: ['companyCommissionValue'] });
  }
});

export const createOutstationPackageSchema = z.object({
  name: z.string().min(1).max(200),
  terrain: z.enum(['PLAIN', 'HILL']),
  minKm: z.number().int().min(0),
  maxKm: z.number().int().min(1),
  pickupZoneIds: z.array(z.string().min(1)).min(1),
  prices: z.array(outstationPriceSchema).min(1),
  isActive: z.boolean().optional().default(true),
});

export const updateIncityPackageSchema = createIncityPackageSchema.partial();
export const updateOutstationPackageSchema = createOutstationPackageSchema.partial();

export const listPackagesQuerySchema = z.object({
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const listOutstationQuerySchema = listPackagesQuerySchema.extend({
  terrain: z.enum(['PLAIN', 'HILL']).optional(),
});

export const packageIdParamSchema = z.object({
  id: z.string().min(1),
});
