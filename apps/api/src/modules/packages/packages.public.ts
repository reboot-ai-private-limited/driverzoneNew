import type { IncityPackage, IncityVariant } from './domain/incityPackage.entity.js';
import type { OutstationPackage, OutstationPrice } from './domain/outstationPackage.entity.js';

export interface TripContext {
  /** The city zone ID if the pickup point is inside a city zone */
  fromCityZoneId?: string;
  /** True if the drop point is inside the same city zone */
  toSameCityZone: boolean;
  /** True if the drop point is inside a hill zone */
  toHillZone: boolean;
  /** Road distance in kilometers */
  distanceKm: number;
  /** The requested car category ID */
  carCategoryId: string;
  /** Optional direction for outstation trips. Defaults to ONE_WAY */
  direction?: 'ONE_WAY' | 'ROUND_TRIP';
}

export interface IncityMatch {
  type: 'INCITY';
  package: IncityPackage;
  // All active variants that have an active price for the car category
  variants: IncityVariant[]; 
}

export interface OutstationMatch {
  type: 'OUTSTATION';
  package: OutstationPackage;
  // Exactly one price row for (carCategoryId, direction)
  price: OutstationPrice;
}

export type PackageMatch = IncityMatch | OutstationMatch;

export interface Unavailable {
  available: false;
  code: 'NO_PACKAGE_AVAILABLE' | 'NO_PACKAGE_FOR_DISTANCE' | 'NO_CAR_CATEGORY_PRICE';
  message: string;
}

/** Read-only. quotes calls this; it cannot write a package. */
export interface PackageLookupContract {
  /** Exactly one package, or a typed reason why none applies. */
  resolveForTrip(input: TripContext): Promise<{ available: true; match: PackageMatch } | Unavailable>;
}

export type PackagesPublicContract = PackageLookupContract;

export type { IncityPackage, IncityVariant, IncityPrice, CommissionType } from './domain/incityPackage.entity.js';
export type { OutstationPackage, OutstationPrice, Direction } from './domain/outstationPackage.entity.js';
