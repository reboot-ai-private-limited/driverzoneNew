'use client';

import { useQuery } from '@tanstack/react-query';
import type { IncityPackageDto } from '@driverzone/contracts';
import { packagesApi } from '@/lib/api/endpoints/packages';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * The incity packages, so the city card can say what sells against the city zone.
 *
 * This is the one cross-module read on the zones screen and it is deliberately READ-ONLY. The
 * package editor is a different screen; two screens owning one form is how they drift. What
 * belongs here is the FACT of the relationship, because it is invisible everywhere else:
 * `cityZoneId` is the only zone reference either product carries (docs/LLD/packages.md), and an
 * admin about to deactivate a city zone has no other way to see what goes dark with it.
 */
export function useIncityPackages() {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.packages.incityList(),
      fetch: (token, signal) => packagesApi.listIncity(token, undefined, signal),
      staleTime: staleTime.configuration,
    }),
  );
}

/**
 * `GET /admin/packages/incity` has no `city_zone_id` filter and does not need one — there is a
 * single city zone, so the whole list is that zone's list. Filtering client-side keeps it
 * correct anyway for the day a second city is drawn, at which point this function is already
 * right and only the admin surface needs the switcher (docs/LLD/zones.md §The Siliguri instance).
 */
export function packagesForZone(
  packages: IncityPackageDto[] | undefined,
  zoneId: string,
): IncityPackageDto[] {
  return (packages ?? []).filter((pkg) => pkg.city_zone_id === zoneId);
}
