/**
 * The packages wire format. `apps/api/src/modules/packages/interface/packages.swagger.ts`
 * already declares its response DTOs as "mirroring @driverzone/contracts's packages.ts
 * field-for-field" — this is that file.
 *
 * Only the READ shapes are here. The write shapes stay in the API's Zod schemas until a screen
 * needs them: `zones.ts` spells out the `| undefined` convention `exactOptionalPropertyTypes`
 * forces on request types, and there is no reason to pay that cost for requests nothing sends
 * yet.
 *
 * The one consumer today is the zones screen's city card, which counts the packages selling
 * against the city zone. That count is the whole point: a city zone with zero active incity
 * packages is a city where every hourly quote returns NO_PACKAGE_AVAILABLE, and nothing else
 * in the panel would show it.
 */

export type CommissionType = 'PERCENT' | 'FLAT';

export interface IncityPriceDto {
  car_category_id: string;
  base_fare_paise: number;
  extra_minute_rate_paise: number;
  extra_km_rate_paise: number;
  night_charge_paise: number;
  driver_commission_type: CommissionType;
  driver_commission_value: number;
  company_commission_type: CommissionType;
  company_commission_value: number;
  is_active: boolean;
}

export interface IncityVariantDto {
  label: string;
  included_minutes: number;
  included_km: number;
  /** Per-variant because it defaults from duration — off above 4 hours. open-questions.md Q1. */
  enforce_drop_in_city: boolean;
  prices: IncityPriceDto[];
  sort_order: number;
  is_active: boolean;
}

/**
 * The only zone reference either product carries. Outstation packages reference no zone at all;
 * neither references a pickup zone (docs/LLD/packages.md §The two products).
 */
export interface IncityPackageDto {
  id: string;
  city_zone_id: string;
  name: string;
  description?: string;
  variants: IncityVariantDto[];
  is_active: boolean;
}

export interface ListIncityPackagesResponse {
  packages: IncityPackageDto[];
}

/**
 * `GET /admin/packages/incity` takes no `city_zone_id` filter, and does not need one: there is
 * one city zone, so the whole list is the city's list. Callers that want a specific zone's
 * packages filter client-side — see `useIncityPackagesForZone` in apps/web.
 */
export interface ListIncityPackagesQuery {
  is_active?: boolean | undefined;
}
