'use client';

import { useQuery } from '@tanstack/react-query';
import { zonesApi } from '@/lib/api/endpoints/zones';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * The blast radius, read BEFORE the confirm dialog renders — never after the click.
 *
 * `GET /admin/zones/:id/dependents` never blocks and never fails a deactivation: it returns
 * human-readable warnings and the admin decides. Blocking outright is wrong, because sometimes
 * you genuinely must pull a zone; a bare "Are you sure?" is also wrong, because the one case
 * that matters — the LAST active pickup zone, where deactivating stops all service, incity and
 * outstation both — looks identical to every other deactivation without it.
 *
 * `staleTime.live`: this is read at the moment of a decision, and a cached answer from ten
 * minutes ago is exactly the wrong thing to show someone about to take a city offline.
 */
export function useZoneDependents(zoneId: string | null) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.zones.dependents(zoneId ?? ''),
      fetch: (token, signal) => zonesApi.dependents(token, zoneId as string, signal),
      staleTime: staleTime.live,
      enabled: zoneId !== null,
    }),
  );
}
