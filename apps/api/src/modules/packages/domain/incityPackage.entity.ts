export type CommissionType = 'PERCENT' | 'FLAT';

export interface IncityPrice {
  id: string;
  carCategoryId: string;
  baseFarePaise: number;
  /** Overage beyond the variant's included minutes. See open-questions.md Q2. */
  extraMinuteRatePaise: number;
  /** Overage beyond the variant's included km. Billed independently of time, never netted. */
  extraKmRatePaise: number;
  nightChargePaise: number;
  driverCommissionType: CommissionType;
  driverCommissionValue: number;
  companyCommissionType: CommissionType;
  companyCommissionValue: number;
  isActive: boolean;
}

export interface IncityVariant {
  id: string;
  label: string;
  includedMinutes: number;
  includedKm: number;
  enforceDropInCity: boolean;
  prices: IncityPrice[];
  sortOrder: number;
  isActive: boolean;
}

export interface IncityPackage {
  id: string;
  cityZoneId: string;
  name: string;
  description?: string | undefined;
  variants: IncityVariant[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function hasActiveVariantWithPrice(pkg: {
  variants: Array<{ isActive?: boolean; prices: Array<{ isActive?: boolean }> }>;
}): boolean {
  return pkg.variants.some(
    (v) => v.isActive !== false && v.prices.some((p) => p.isActive !== false),
  );
}

export function validateIncityPackageActivation(pkg: {
  variants: Array<{ isActive?: boolean; prices: Array<{ isActive?: boolean }> }>;
}): string | null {
  if (!hasActiveVariantWithPrice(pkg)) {
    return 'An active incity package must have at least one active variant with an active price';
  }
  return null;
}
