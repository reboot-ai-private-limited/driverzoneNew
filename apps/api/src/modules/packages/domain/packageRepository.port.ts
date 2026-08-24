import type { IncityPackage } from './incityPackage.entity.js';
import type { OutstationPackage } from './outstationPackage.entity.js';
import type { Terrain } from '@driverzone/geo';
import type { Direction } from './outstationPackage.entity.js';

export interface CreateIncityPackageData {
  cityZoneId: string;
  pickupZoneIds: string[];
  name: string;
  description?: string | undefined;
  variants: Array<{
    label: string;
    includedMinutes: number;
    includedKm: number;
    enforceDropInCity?: boolean;
    prices: Array<{
      carCategoryId: string;
      baseFarePaise: number;
      extraMinuteRatePaise?: number;
      extraKmRatePaise?: number;
      nightChargePaise?: number;
      driverCommissionType: 'PERCENT' | 'FLAT';
      driverCommissionValue: number;
      companyCommissionType: 'PERCENT' | 'FLAT';
      companyCommissionValue: number;
      isActive?: boolean;
    }>;
    sortOrder?: number;
    isActive?: boolean;
  }>;
  isActive?: boolean;
}

export interface CreateOutstationPackageData {
  name: string;
  terrain: Terrain;
  minKm: number;
  maxKm: number;
  pickupZoneIds: string[];
  prices: Array<{
    carCategoryId: string;
    direction: Direction;
    baseFarePaise: number;
    extraKmRatePaise?: number;
    driverAllowancePaise?: number;
    driverCommissionType: 'PERCENT' | 'FLAT';
    driverCommissionValue: number;
    companyCommissionType: 'PERCENT' | 'FLAT';
    companyCommissionValue: number;
    isActive?: boolean;
  }>;
  isActive?: boolean;
}

export interface ListPackageFilter {
  isActive?: boolean | undefined;
}

export interface ListOutstationFilter extends ListPackageFilter {
  terrain?: Terrain | undefined;
}

export interface OverlapQuery {
  terrain: Terrain;
  minKm: number;
  maxKm: number;
  pickupZoneIds: string[];
  excludeId?: string;
}

export interface PackageRepositoryPort {
  createIncity(data: CreateIncityPackageData): Promise<IncityPackage>;
  createOutstation(data: CreateOutstationPackageData): Promise<OutstationPackage>;

  findIncityById(id: string): Promise<IncityPackage | null>;
  findOutstationById(id: string): Promise<OutstationPackage | null>;

  listIncity(filter: ListPackageFilter): Promise<IncityPackage[]>;
  listOutstation(filter: ListOutstationFilter): Promise<OutstationPackage[]>;

  findIncityForQuote(query: { cityZoneId: string; pickupZoneId: string }): Promise<IncityPackage[]>;
  findOutstationForQuote(query: {
    terrain: Terrain;
    distanceKm: number;
    pickupZoneId: string;
  }): Promise<OutstationPackage[]>;

  findOverlappingBands(query: OverlapQuery): Promise<OutstationPackage | null>;

  updateIncity(id: string, data: Partial<CreateIncityPackageData>): Promise<IncityPackage | null>;
  updateOutstation(id: string, data: Partial<CreateOutstationPackageData>): Promise<OutstationPackage | null>;
}
