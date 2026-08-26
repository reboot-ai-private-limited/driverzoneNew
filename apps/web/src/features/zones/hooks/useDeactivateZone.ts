'use client';

import { zonesApi } from '@/lib/api/endpoints/zones';
import { keys } from '@/lib/query/keys';
import { useApiMutation } from '@/lib/query/mutation';

/**
 * Soft-deactivate a zone. The first write in the panel, and the shape every other one copies.
 *
 * No idempotency key: `DELETE /admin/zones/:id` is idempotent server-side — the zone stays for
 * the bookings that resolved against it, and deactivating an already-inactive zone is a no-op.
 * The key belongs on writes that CREATE, where a replay makes a second row.
 *
 * No optimistic update either. Deactivation is what makes a zone stop matching bookings, and a
 * row that flips to "Inactive" and flips back on failure tells an admin the opposite of the
 * truth for as long as the request is in flight.
 */
export function useDeactivateZone() {
  return useApiMutation<string, unknown>({
    call: (token, id) => zonesApi.deactivate(token, id),
    // The whole subtree, not just the list: a detail view and a dependents panel are looking at
    // the same zone, and the one that goes stale is always the one nobody thought about.
    invalidates: [keys.zones.all()],
    successMessage: 'Zone deactivated.',
  });
}
