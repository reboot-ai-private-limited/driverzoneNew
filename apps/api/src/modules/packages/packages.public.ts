import type { IncityPackage } from './domain/incityPackage.entity.js';
import type { OutstationPackage } from './domain/outstationPackage.entity.js';
import type { Terrain } from '@driverzone/geo';

export interface PackageLookupContract {
  findIncityPackages(query: {
    cityZoneId: string;
    pickupZoneId: string;
  }): Promise<IncityPackage[]>;

  findOutstationPackage(query: {
    terrain: Terrain;
    distanceKm: number;
    pickupZoneId: string;
  }): Promise<OutstationPackage[]>;
}

export type PackagesPublicContract = PackageLookupContract;

export type { IncityPackage, IncityVariant, IncityPrice, CommissionType } from './domain/incityPackage.entity.js';
export type { OutstationPackage, OutstationPrice, Direction } from './domain/outstationPackage.entity.js';
