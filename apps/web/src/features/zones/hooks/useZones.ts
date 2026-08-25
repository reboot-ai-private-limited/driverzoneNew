'use client';

import { useQuery } from '@tanstack/react-query';
import type { ListZonesQuery } from '@driverzone/contracts';
import { zonesApi } from '@/lib/api/endpoints/zones';
import { withAuth } from '@/lib/auth/session';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * `withAuth` wraps the call rather than the hook reading a token itself: it supplies the
 * current access token, and on a 401 refreshes ONCE and replays — sharing that refresh with
 * every other query in flight. A per-query retry could not do that, and six independent
 * refreshes would present five spent rotation tokens and revoke the session family.
 */
export function useZones(query?: ListZonesQuery) {
  return useQuery({
    queryKey: keys.zones.list(query),
    queryFn: () => withAuth((token) => zonesApi.list(token, query)),
    staleTime: staleTime.configuration,
    // Zone configuration is edited by a handful of people who need to see each other's work,
    // so coming back to the tab should show what changed.
    refetchOnWindowFocus: true,
  });
}
