/**
 * DOMAIN — the incity product: an hourly driver rental sold against one city zone.
 *
 * A variant carries its own price. There is no `prices[]` keyed by car category any more — an
 * SUV and a hatchback pay the same fare, retired 2026-08-28 (docs/decision-log.md).
 */

export interface IncityVariant {
  id: string;
  label: string;
  includedMinutes: number;
  includedKm: number;
  baseFarePaise: number;
  /** Overage beyond the variant's included minutes. See open-questions.md Q2. */
  extraMinuteRatePaise: number;
  /** Overage beyond the variant's included km. Billed independently of time, never netted. */
  extraKmRatePaise: number;
  /** The driver's share in basis points. The company's is `10000 - this`, never stored. */
  driverCommissionBps: number;
  enforceDropInCity: boolean;
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

/**
 * P-3, for incity.
 *
 * It used to read "at least one active variant with an active price", because a variant could
 * hold zero priced categories and still look healthy. A variant now carries its fare
 * structurally, so having one active variant IS being sellable — the invariant survives, the
 * inner clause does not.
 */
export function hasActiveVariant(pkg: { variants: Array<{ isActive?: boolean }> }): boolean {
  return pkg.variants.some((variant) => variant.isActive !== false);
}

export function validateIncityPackageActivation(pkg: {
  variants: Array<{ isActive?: boolean }>;
}): string | null {
  if (!hasActiveVariant(pkg)) {
    return 'An active incity package must have at least one active variant';
  }
  return null;
}
