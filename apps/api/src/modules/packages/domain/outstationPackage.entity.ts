import type { Direction } from '@driverzone/contracts';
import type { Terrain } from '@driverzone/geo';

/**
 * DOMAIN — the outstation product: a point-to-point trip out of the city, matched by terrain and
 * a road-distance band.
 *
 * THE BAND IS THE PRICE. There is no `prices[]` and no per-km rate: 72 km and 98 km both pay the
 * `70–100` fare. That closes open-questions.md Q3, and its documented cost is that flat pricing
 * needs many narrow bands — hence the split action in the admin panel.
 */

export type { Direction };

export interface OutstationVariant {
  id: string;
  label: string;
  includedMinutes: number;
  baseFarePaise: number;
  driverAmountPaise: number;
  isActive: boolean;
}

export interface OutstationPackage {
  id: string;
  name: string;
  terrain: Terrain;
  /** Half-open `[minKm, maxKm)`. P-4. */
  minKm: number;
  maxKm: number;
  oneWayFarePaise: number;
  /**
   * `null` means a same-day return is NOT OFFERED on this band — not that it is free. A long
   * hill band the driver cannot get back from the same day is a real case, and this is the
   * successor to the old "leave the price row out" affordance.
   */
  roundTripFarePaise: number | null;
  /**
   * What the driver is paid for a one-way trip on this band, in paise, PER DAY.
   */
  oneWayDriverAmountPaise: number;
  /**
   * What the driver is paid for a round trip on this band, in paise, PER DAY.
   * `null` exactly when `roundTripFarePaise` is `null` — the band doesn't sell that direction.
   */
  roundTripDriverAmountPaise: number | null;
  /**
   * Hourly-package variants offered on this band (e.g. "8 Hours", "12 Hours").
   */
  variants: OutstationVariant[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** The fare for a direction, or `null` when the band does not sell that direction. */
export function fareFor(pkg: OutstationPackage, direction: Direction): number | null {
  return direction === 'ROUND_TRIP' ? pkg.roundTripFarePaise : pkg.oneWayFarePaise;
}

/** The driver amount for a direction, or `null` when the band does not sell that direction. */
export function driverAmountFor(pkg: OutstationPackage, direction: Direction): number | null {
  return direction === 'ROUND_TRIP' ? pkg.roundTripDriverAmountPaise : pkg.oneWayDriverAmountPaise;
}

export function validateOutstationBand(minKm: number, maxKm: number): string | null {
  if (minKm < 0) return 'minKm must be >= 0';
  if (maxKm <= minKm) return 'maxKm must be greater than minKm';
  return null;
}

/**
 * THE DRIVER AMOUNTS MAY NOT EXCEED THE FARES THEY ARE PAID OUT OF.
 *
 * Each direction is checked independently against its own fare:
 * - One-way driver amount <= one-way fare
 * - If a round-trip fare is offered, round-trip driver amount is required and <= round-trip fare.
 */
export function validateOutstationDriverAmounts(pkg: {
  oneWayFarePaise: number;
  roundTripFarePaise: number | null;
  oneWayDriverAmountPaise: number;
  roundTripDriverAmountPaise: number | null;
}): string | null {
  if (pkg.oneWayDriverAmountPaise > pkg.oneWayFarePaise) {
    return `The one-way driver amount (₹${String(pkg.oneWayDriverAmountPaise / 100)}) cannot exceed the one-way fare (₹${String(pkg.oneWayFarePaise / 100)})`;
  }
  if (pkg.roundTripFarePaise !== null) {
    if (pkg.roundTripDriverAmountPaise === null) {
      return 'This band sells a round trip — set what the driver is paid for it.';
    }
    if (pkg.roundTripDriverAmountPaise > pkg.roundTripFarePaise) {
      return `The round-trip driver amount (₹${String(pkg.roundTripDriverAmountPaise / 100)}) cannot exceed the round-trip fare (₹${String(pkg.roundTripFarePaise / 100)})`;
    }
  }
  return null;
}

/**
 * Validates that each outstation hourly variant's driver payout does not exceed its base fare.
 */
export function validateOutstationVariantAmounts(pkg: {
  variants?: Array<{ label: string; baseFarePaise: number; driverAmountPaise: number }> | undefined;
}): string | null {
  if (!pkg.variants) return null;
  for (const variant of pkg.variants) {
    if (variant.driverAmountPaise > variant.baseFarePaise) {
      return `Variant "${variant.label}": the driver amount (₹${String(variant.driverAmountPaise / 100)}) cannot exceed the fare (₹${String(variant.baseFarePaise / 100)})`;
    }
  }
  return null;
}
