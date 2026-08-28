/**
 * DOMAIN — the incity product: an hourly driver rental sold against one city zone.
 *
 * A variant carries its own price. There is no `prices[]` keyed by car category any more — an
 * SUV and a hatchback pay the same fare, retired 2026-08-28 (docs/decision-log.md).
 *
 * It used to also carry an included-km cap, two overage rates, a destination-enforcement flag and
 * a sort order. All four went the same day; see `IncityVariant` below.
 */

/**
 * A duration and a price, and nothing else.
 *
 * THERE IS NO OVERAGE. `includedMinutes` is what the customer buys and what tells the driver when
 * they are released; a booking that runs past it is an operations conversation, not a fare line.
 * `extraMinuteRatePaise`, `extraKmRatePaise` and the `includedKm` cap they billed against were
 * removed 2026-08-28, closing open-questions.md Q2 by deciding there is nothing to bill.
 *
 * `enforceDropInCity` went with them (Q1): there is no per-variant destination rule any more.
 * `sortOrder` too — variants display in stored order, which is the order the editor lists them in.
 */
export interface IncityVariant {
  id: string;
  label: string;
  includedMinutes: number;
  baseFarePaise: number;
  /** The driver's share in basis points. The company's is `10000 - this`, never stored. */
  driverCommissionBps: number;
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
