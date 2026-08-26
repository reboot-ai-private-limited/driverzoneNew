import type { Terrain } from '@driverzone/geo';
import type { IncityPackage } from './incityPackage.entity.js';
import type { Direction, OutstationPackage } from './outstationPackage.entity.js';

/**
 * PORT — what the domain needs from persistence, without naming Mongo.
 *
 * The `*Patch` types below spell out `| undefined` on every optional field rather than using
 * `Partial<Create*Data>`. Under `exactOptionalPropertyTypes` those are different types: the
 * first permits `{ name: undefined }`, the second forbids it — and `z.infer` of a `.partial()`
 * schema produces the permissive one, so a `Partial<>` here is a type error at the controller
 * that can only be silenced with a cast. Same convention, same reason, as the REQUEST shapes in
 * `packages/contracts/src/zones.ts`.
 */

export interface CreateIncityPackageData {
  cityZoneId: string;
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

/** What `updateIncityPackage` writes. Sending `variants` REPLACES the array — see the use case. */
export type IncityPackagePatch = {
  [K in keyof CreateIncityPackageData]?: CreateIncityPackageData[K] | undefined;
};

/** What `updateOutstationPackage` writes. Same replace-not-merge caveat on `prices`. */
export type OutstationPackagePatch = {
  [K in keyof CreateOutstationPackageData]?: CreateOutstationPackageData[K] | undefined;
};

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
  excludeId?: string;
}

export interface PackageRepositoryPort {
  createIncity(data: CreateIncityPackageData): Promise<IncityPackage>;
  createOutstation(data: CreateOutstationPackageData): Promise<OutstationPackage>;

  findIncityById(id: string): Promise<IncityPackage | null>;
  findOutstationById(id: string): Promise<OutstationPackage | null>;

  listIncity(filter: ListPackageFilter): Promise<IncityPackage[]>;
  listOutstation(filter: ListOutstationFilter): Promise<OutstationPackage[]>;

  findIncityForQuote(query: { cityZoneId: string }): Promise<IncityPackage[]>;
  findOutstationForQuote(query: {
    terrain: Terrain;
    distanceKm: number;
  }): Promise<OutstationPackage[]>;

  findOverlappingBands(query: OverlapQuery): Promise<OutstationPackage | null>;

  updateIncity(id: string, data: IncityPackagePatch): Promise<IncityPackage | null>;
  updateOutstation(id: string, data: OutstationPackagePatch): Promise<OutstationPackage | null>;
}
