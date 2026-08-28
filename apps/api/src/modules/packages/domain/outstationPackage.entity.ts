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
  /** The driver's share in basis points. The company's is `10000 - this`, never stored. */
  driverCommissionBps: number;
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
 * P-3 is RETIRED for outstation, and this note is the hole where
 * `validateOutstationPackageActivation` used to be.
 *
 * The invariant said an active package must hold at least one active price row, because the
 * price rows were a separate array that could be empty or entirely switched off. A band now
 * carries `oneWayFarePaise` as a required field, so "active but impossible to sell" is not a
 * state this type can represent. An invariant that cannot be violated is not a guard, it is a
 * comment — so it is one.
 */
