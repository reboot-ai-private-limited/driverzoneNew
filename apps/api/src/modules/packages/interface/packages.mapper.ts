import type {
  IncityPackageDto,
  IncityVariantDto,
  OutstationPackageDto,
} from '@driverzone/contracts';
import type { IncityPackage, IncityVariant } from '../domain/incityPackage.entity.js';
import type { OutstationPackage } from '../domain/outstationPackage.entity.js';

/**
 * INTERFACE — camelCase domain entity in, snake_case wire DTO out.
 *
 * This file exists because it was missing, and its absence was not theoretical. The controllers
 * used to hand the domain entity straight to `sendSuccess`, so `GET /admin/packages/incity`
 * returned `cityZoneId` while `@driverzone/contracts` and the swagger both promised
 * `city_zone_id`. `packagesForZone` in apps/web filtered on the documented name, matched nothing,
 * and the zones screen's city card silently reported zero packages for a zone that had some.
 *
 * The mapper alone would not have prevented that — someone still has to keep it in step with the
 * DTOs. `packages.typecheck.ts` is the half that makes it a guarantee.
 *
 * `createdAt`/`updatedAt` are deliberately dropped. They are on the entity because Mongoose puts
 * them there; nothing on the wire has ever needed them, and a field nobody reads is a field that
 * gets a meaning invented for it later.
 */

function toIncityVariantDto(variant: IncityVariant): IncityVariantDto {
  return {
    id: variant.id,
    label: variant.label,
    included_minutes: variant.includedMinutes,
    included_km: variant.includedKm,
    base_fare_paise: variant.baseFarePaise,
    extra_minute_rate_paise: variant.extraMinuteRatePaise,
    extra_km_rate_paise: variant.extraKmRatePaise,
    driver_commission_bps: variant.driverCommissionBps,
    enforce_drop_in_city: variant.enforceDropInCity,
    sort_order: variant.sortOrder,
    is_active: variant.isActive,
  };
}

export function toIncityPackageDto(pkg: IncityPackage): IncityPackageDto {
  return {
    id: pkg.id,
    city_zone_id: pkg.cityZoneId,
    name: pkg.name,
    // `exactOptionalPropertyTypes`: the DTO says `description?: string`, which forbids the key
    // being present and undefined. Spread it in or leave it out.
    ...(pkg.description === undefined ? {} : { description: pkg.description }),
    variants: pkg.variants.map(toIncityVariantDto),
    is_active: pkg.isActive,
  };
}

export function toOutstationPackageDto(pkg: OutstationPackage): OutstationPackageDto {
  return {
    id: pkg.id,
    name: pkg.name,
    terrain: pkg.terrain,
    min_km: pkg.minKm,
    max_km: pkg.maxKm,
    one_way_fare_paise: pkg.oneWayFarePaise,
    // Passed through as `null`, never coerced to 0. The DTO's own comment carries the reason:
    // a band that does not sell a same-day return is not a band that sells it for nothing.
    round_trip_fare_paise: pkg.roundTripFarePaise,
    driver_commission_bps: pkg.driverCommissionBps,
    is_active: pkg.isActive,
  };
}
