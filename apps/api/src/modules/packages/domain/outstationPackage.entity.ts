import type { CommissionType } from './incityPackage.entity.js';
import type { Terrain } from '@driverzone/geo';

export type Direction = 'ONE_WAY' | 'ROUND_TRIP';

export interface OutstationPrice {
  id: string;
  carCategoryId: string;
  direction: Direction;
  baseFarePaise: number;
  extraKmRatePaise: number;
  driverAllowancePaise: number;
  driverCommissionType: CommissionType;
  driverCommissionValue: number;
  companyCommissionType: CommissionType;
  companyCommissionValue: number;
  isActive: boolean;
}

export interface OutstationPackage {
  id: string;
  name: string;
  terrain: Terrain;
  minKm: number;
  maxKm: number;
  pickupZoneIds: string[];
  prices: OutstationPrice[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function validateOutstationBand(minKm: number, maxKm: number): string | null {
  if (minKm < 0) return 'minKm must be >= 0';
  if (maxKm <= minKm) return 'maxKm must be greater than minKm';
  return null;
}

export function validateOutstationPackageActivation(pkg: {
  pickupZoneIds: string[];
  prices: Array<{ isActive?: boolean }>;
}): string | null {
  if (pkg.pickupZoneIds.length === 0) {
    return 'An active outstation package must have at least one pickup zone';
  }
  if (!pkg.prices.some((p) => p.isActive !== false)) {
    return 'An active outstation package must have at least one active price';
  }
  return null;
}
