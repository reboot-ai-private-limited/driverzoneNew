'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ZoneDto, ZoneType, ZoneViolationDto } from '@driverzone/contracts';
import { validateZone, zoneStats, type NamedZone, type Polygon } from '@driverzone/geo';
import { zonesApi } from '@/lib/api/endpoints/zones';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { VALIDATE_DEBOUNCE_MS } from '@/lib/hooks/timing';

/**
 * Live geometry validation, run TWICE on purpose.
 *
 * LOCALLY, synchronously, on every vertex move. The browser already holds every active zone, so
 * it can run the whole rule set — including Z-2 sibling overlap — with no network at all. This
 * is what paints an edge red *while* a corner is being dragged, and a 400 ms round trip cannot.
 *
 * ON THE SERVER, debounced, as the authority. The browser's sibling list is a cached list and
 * can be stale; the API's is the database. When the two disagree the server wins, and the
 * disagreement is itself the signal — it means another admin saved a zone while this one was
 * drawing.
 *
 * The two CANNOT drift, because `validateZone` here is not a second implementation of the
 * server's check — it is literally the same function from `@driverzone/geo`, which is the
 * entire reason that package exists (docs/engineering/shared-packages.md).
 */

export interface ZoneValidation {
  violations: ZoneViolationDto[];
  /** Save is blocked while any of these stands. `Z-COMPLEXITY` is a WARN and must not block. */
  errors: ZoneViolationDto[];
  warnings: ZoneViolationDto[];
  areaKm2: number;
  vertexCount: number;
  /** The server has not yet confirmed the shape on screen. Never blocks the UI, only annotates it. */
  confirming: boolean;
}

/** `@driverzone/geo` returns `ZoneViolation`; the wire type is `ZoneViolationDto`. Same shape. */
function toDto(violations: ReturnType<typeof validateZone>): ZoneViolationDto[] {
  return violations.map((violation) => ({
    rule: violation.rule,
    severity: violation.severity,
    message: violation.message,
    ...(violation.offendingGeometry === undefined
      ? {}
      : { offendingGeometry: violation.offendingGeometry }),
  }));
}

export function useZoneValidation(input: {
  geometry: Polygon | null;
  type: ZoneType;
  /** Every zone the panel knows about — filtered to same-type active siblings below. */
  zones: ZoneDto[];
  /** The zone being edited, so it does not conflict with its own current version. */
  excludeZoneId?: string | undefined;
  enabled: boolean;
}): ZoneValidation {
  const { geometry, type, zones, excludeZoneId, enabled } = input;

  /**
   * Z-2 is same-type only, and ACTIVE-only. A hill zone overlapping the city zone is perfectly
   * legal — precedence picks incity — and including cross-type zones here would block a save
   * the API would have accepted, which is the one way the two verdicts can appear to disagree
   * without either being wrong.
   */
  const siblings = useMemo<NamedZone[]>(
    () =>
      zones
        .filter((zone) => zone.type === type && zone.is_active && zone.id !== excludeZoneId)
        .map((zone) => ({ id: zone.id, name: zone.name, geom: zone.geometry })),
    [zones, type, excludeZoneId],
  );

  const local = useMemo(() => {
    if (geometry === null || !enabled) return null;
    try {
      return toDto(validateZone({ geom: geometry, siblings }));
    } catch {
      // Turf's constructors throw on a ring that is not yet a ring — which is every polygon
      // mid-draw, before the third click. Not an error state: there is simply nothing to
      // validate yet, and reporting one would put a red banner over a normal first click.
      return null;
    }
  }, [geometry, siblings, enabled]);

  const stats = useMemo(() => {
    if (geometry === null) return { areaKm2: 0, vertexCount: 0 };
    try {
      return zoneStats(geometry);
    } catch {
      return { areaKm2: 0, vertexCount: geometry.coordinates[0]?.length ?? 0 };
    }
  }, [geometry]);

  // Debouncing here is not about duplicate requests — TanStack de-duplicates identical
  // in-flight keys already. It is about not creating forty DIFFERENT keys for one drag.
  const settled = useDebouncedValue(geometry, VALIDATE_DEBOUNCE_MS);
  const fingerprint = useMemo(() => (settled === null ? '' : JSON.stringify(settled)), [settled]);

  const server = useQuery(
    authedQueryOptions({
      queryKey: keys.zones.validate(fingerprint),
      fetch: (token, signal) =>
        zonesApi.validate(
          token,
          {
            type,
            geometry: settled as Polygon,
            ...(excludeZoneId === undefined ? {} : { exclude_zone_id: excludeZoneId }),
          },
          signal,
        ),
      // A verdict is about one exact shape. It is never reusable, so it is never fresh.
      staleTime: staleTime.live,
      enabled: enabled && settled !== null && local !== null,
    }),
  );

  const confirmed = settled === geometry && server.data !== undefined;
  const violations = confirmed ? (server.data?.violations ?? []) : (local ?? []);

  return {
    violations,
    errors: violations.filter((violation) => violation.severity === 'ERROR'),
    warnings: violations.filter((violation) => violation.severity !== 'ERROR'),
    areaKm2: stats.areaKm2,
    vertexCount: stats.vertexCount,
    confirming: enabled && geometry !== null && !confirmed,
  };
}
