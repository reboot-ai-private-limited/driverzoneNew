'use client';

import { useQuery } from '@tanstack/react-query';
import type { ListOutstationPackagesQuery, ListZonesQuery } from '@driverzone/contracts';
import { packagesApi } from '@/lib/api/endpoints/packages';
import { zonesApi } from '@/lib/api/endpoints/zones';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * The reads behind the packages screen and both editors.
 *
 * The LISTS are unfiltered on purpose. There is one city zone and a handful of distance bands —
 * tens of rows, not thousands — and the outstation coverage ladder needs EVERY active band of a
 * terrain to know where the gaps are. A server-side `terrain` filter would give the ladder a
 * partial picture and make "no gap here" mean "no gap among the rows you asked for", which is
 * the one thing this screen must not get wrong. Filtering is done in the component.
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

export function useOutstationPackages(query?: ListOutstationPackagesQuery) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.packages.outstationList(query),
      fetch: (token, signal) => packagesApi.listOutstation(token, query, signal),
      staleTime: staleTime.configuration,
    }),
  );
}

/**
 * `enabled` on the id: the editor routes share a component between `/new` and `/[id]`, and a
 * `GET /admin/packages/incity/undefined` is a 404 the admin would see as a broken create screen.
 */
export function useIncityPackage(id: string | undefined) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.packages.incityDetail(id ?? ''),
      fetch: (token, signal) => packagesApi.getIncity(token, id ?? '', signal),
      staleTime: staleTime.configuration,
      enabled: id !== undefined,
      // This screen is a form. A refetch while an admin is mid-edit is a reseed they did not ask
      // for — the settings screen refuses it for the same reason.
      refetchOnWindowFocus: false,
    }),
  );
}

export function useOutstationPackage(id: string | undefined) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.packages.outstationDetail(id ?? ''),
      fetch: (token, signal) => packagesApi.getOutstation(token, id ?? '', signal),
      staleTime: staleTime.configuration,
      enabled: id !== undefined,
      refetchOnWindowFocus: false,
    }),
  );
}

/**
 * The city zones the incity editor's picker offers.
 *
 * Reads `zonesApi` directly rather than importing the zones feature's own `useZones`. That is
 * the pattern `features/zones/hooks/useIncityPackages.ts` already established in the other
 * direction: a cross-feature need goes through the shared endpoint layer, never through another
 * feature's hooks, so the two features stay independently deletable.
 */
export function useCityZones() {
  const query: ListZonesQuery = { type: 'CITY', is_active: true };
  return useQuery(
    authedQueryOptions({
      queryKey: keys.zones.list(query),
      fetch: (token, signal) => zonesApi.list(token, query, signal),
      staleTime: staleTime.configuration,
    }),
  );
}
