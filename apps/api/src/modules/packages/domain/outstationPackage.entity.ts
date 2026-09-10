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
   * What the driver is paid for this band, in paise, PER DAY — a flat amount, not a share
   * (2026-09-10). The band fare is a day rate and this is multiplied by the same IST day count in
   * `computeOutstationFare`. `validateOutstationDriverAmount` refuses a value above the one-way
   * fare (and the round-trip fare, when the band sells one).
   */
  driverAmountPaise: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** The fare for a direction, or `null` when the band does not sell that direction. */
export function fareFor(pkg: OutstationPackage, direction: Direction): number | null {
  return direction === 'ROUND_TRIP' ? pkg.roundTripFarePaise : pkg.oneWayFarePaise;
}

export function validateOutstationBand(minKm: number, maxKm: number): string | null {
  if (minKm < 0) return 'minKm must be >= 0';
  if (maxKm <= minKm) return 'maxKm must be greater than minKm';
  return null;
}

/**
 * THE DRIVER AMOUNT MAY NOT EXCEED THE FARE IT IS PAID OUT OF.
 *
 * Same reasoning as the incity twin: `driverAmountPaise` is subtracted from the commissionable
 * subtotal, whose tightest value is the band fare alone. Both the fare and this amount are
 * day rates multiplied by the same day count, so the per-day comparison is the one that has to
 * hold — a value that fits one day fits three.
 *
 * Checked against BOTH directions the band sells. A band with a cheap round-trip fare and a
 * driver amount tuned to the one-way could still go negative on the return.
 */
export function validateOutstationDriverAmount(pkg: {
  oneWayFarePaise: number;
  roundTripFarePaise: number | null;
  driverAmountPaise: number;
}): string | null {
  const floor =
    pkg.roundTripFarePaise === null
      ? pkg.oneWayFarePaise
      : Math.min(pkg.oneWayFarePaise, pkg.roundTripFarePaise);
  if (pkg.driverAmountPaise > floor) {
    return `The driver amount (₹${String(pkg.driverAmountPaise / 100)}) cannot exceed the fare (₹${String(floor / 100)})`;
  }
  return null;
}

/**
 * P-3 is RETIRED for outstation, and this note is the hole where
 * `validateOutstationPackageActivation` used to be.
 *
 * The invariant said an active package must hold at least one active price row, because the
 * price rows were a separate array that could be empty or entirely switched off. A band now
 * carries `oneWayFarePaise` as a required field, so "active but impossible to sell" is not a
 * state this type can represent. An invariant that cannot be violated is not a guard, it is a
 * comment — so it is one.
 */
