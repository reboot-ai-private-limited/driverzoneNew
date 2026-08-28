'use client';

import type { CreateZoneRequest, UpdateZoneMetadataRequest, ZoneDto } from '@driverzone/contracts';
import type { Polygon } from '@driverzone/geo';
import { zonesApi } from '@/lib/api/endpoints/zones';
import { keys } from '@/lib/query/keys';
import { useApiMutation } from '@/lib/query/mutation';

/**
 * The three zone writes. They are three hooks and not one, because the API splits them and the
 * split is load-bearing: `PATCH /:id` changes a name and versions nothing, `PATCH /:id/geometry`
 * creates a new version and carries a concurrency contract, and `POST /` creates. Merging them
 * would give a rename the failure modes of a boundary edit.
 *
 * Every one of them invalidates `keys.zones.all()` rather than a narrower key. A geometry save
 * mutates TWO rows — the new version and the old one it supersedes — and the list, the detail
 * and the dependents view are all now wrong. The one that goes stale is always the one nobody
 * thought about.
 */

/**
 * Creating a zone gets an idempotency key; the two updates do not.
 *
 * A replayed POST makes a second polygon. A replayed PATCH sets the same fields to the same
 * values — and the geometry PATCH is guarded by `expected_version` anyway, which refuses the
 * replay outright with a 409 rather than versioning twice.
 */
export function useCreateZone(onCreated?: (zone: ZoneDto) => void) {
  return useApiMutation<CreateZoneRequest, ZoneDto>({
    call: (token, body, idempotencyKey) => zonesApi.create(token, body, idempotencyKey),
    invalidates: [keys.zones.all()],
    successMessage: 'Zone created.',
    ...(onCreated === undefined ? {} : { onSuccess: onCreated }),
  });
}

export function useUpdateZoneMetadata() {
  return useApiMutation<{ id: string; patch: UpdateZoneMetadataRequest }, ZoneDto>({
    call: (token, vars) => zonesApi.updateMetadata(token, vars.id, vars.patch),
    invalidates: [keys.zones.all()],
    successMessage: 'Zone updated.',
  });
}

/**
 * A geometry save is the one write in the panel that can fail because of somebody ELSE.
 *
 * `expected_version` is what makes two admins editing the same polygon in two tabs produce one
 * save and one clear 409 (`ZONE_ALREADY_SUPERSEDED`) rather than a silent last-write-wins. The
 * caller is expected to catch that code and say what actually happened — see
 * `supersededMessage` — because "Request failed" over an hour of boundary work is how people
 * stop trusting the editor.
 *
 * No success toast: the map redraws to the saved shape and the version number ticks over, which
 * is a better confirmation than a message that covers part of what it is confirming.
 */
export function useUpdateZoneGeometry(onSaved?: (zone: ZoneDto) => void) {
  return useApiMutation<{ id: string; geometry: Polygon; expectedVersion: number }, ZoneDto>({
    call: (token, vars) =>
      zonesApi.updateGeometry(token, vars.id, {
        geometry: vars.geometry,
        expected_version: vars.expectedVersion,
      }),
    invalidates: [keys.zones.all()],
    ...(onSaved === undefined ? {} : { onSuccess: onSaved }),
  });
}
