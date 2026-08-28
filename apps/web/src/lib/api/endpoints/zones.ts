import type {
  CreateZoneRequest,
  ListZonesQuery,
  ListZonesResponse,
  UpdateZoneGeometryRequest,
  UpdateZoneMetadataRequest,
  ValidateZoneRequest,
  ValidateZoneResponse,
  ZoneDependentsResponse,
  ZoneDto,
} from '@driverzone/contracts';
import { request } from '../client';

/**
 * `/admin/zones` — mirrors `apps/api/src/modules/zones/interface/admin.routes.ts` one-for-one.
 *
 * Zone geometry crosses the wire as raw GeoJSON, not `{lat,lng}` (docs/decision-log.md,
 * 2026-08-24), so nothing here converts coordinates. `@driverzone/geo` is the only place that
 * happens, and the editor calls it for live validation with the same code the API uses.
 *
 * READS TAKE A TRAILING `signal`; WRITES DO NOT. A read is abandoned the moment its query key
 * changes — TanStack Query supplies the signal for exactly that — whereas a write that has
 * already reached the server cannot be un-sent, and aborting one only loses us the answer to
 * something that happened anyway.
 */
export const zonesApi = {
  list: (token: string, query?: ListZonesQuery, signal?: AbortSignal) =>
    request<ListZonesResponse>('/admin/zones', {
      token,
      signal,
      // `parent_zone_id` is gone from the query: Z-1 is retired and a pickup zone is not a
      // child of anything (docs/decision-log.md, 2026-08-25). `ZoneDto` still carries the
      // field, dormant and always null.
      ...(query === undefined ? {} : { query: { type: query.type, is_active: query.is_active } }),
    }),

  get: (token: string, id: string, signal?: AbortSignal) =>
    request<ZoneDto>(`/admin/zones/${id}`, { token, signal }),

  /**
   * Called on every geometry change while drawing, debounced by `VALIDATE_DEBOUNCE_MS` — never
   * only on save (docs/LLD/admin-panel.md §Live validation).
   *
   * A POST that reads: it changes nothing, and it is the one call in this file that MUST honour
   * the signal. Without it a fast edit leaves several validations racing, and the verdict shown
   * is whichever reply arrived last rather than the one for the shape now on screen.
   */
  validate: (token: string, body: ValidateZoneRequest, signal?: AbortSignal) =>
    request<ValidateZoneResponse>('/admin/zones/validate', {
      method: 'POST',
      token,
      body,
      signal,
    }),

  /**
   * Read BEFORE anything happens, to show the blast radius. Returns human-readable warnings
   * and never blocks — deactivation is always allowed, and the admin decides.
   */
  dependents: (token: string, id: string, signal?: AbortSignal) =>
    request<ZoneDependentsResponse>(`/admin/zones/${id}/dependents`, { token, signal }),

  /**
   * Soft-deactivate. `DELETE` here is not destructive: the zone stays for the bookings that
   * resolved against it, and the permanent removal is a separate route (`/hard`) that only
   * works once the zone is already inactive. Two verbs, two routes, on purpose.
   */
  deactivate: (token: string, id: string) =>
    request<ZoneDto>(`/admin/zones/${id}`, { method: 'DELETE', token }),

  create: (token: string, body: CreateZoneRequest, idempotencyKey: string) =>
    request<ZoneDto>('/admin/zones', { method: 'POST', token, body, idempotencyKey }),

  /**
   * Metadata only — name, code, priority, pickup charge. NEVER geometry.
   *
   * The split is the API's (`PATCH /:id` vs `PATCH /:id/geometry`) and it is not cosmetic: this
   * route does not version the zone and carries no concurrency contract, so collapsing the two
   * would make every rename inherit the `expected_version` failure mode of a boundary edit for
   * no reason (docs/LLD/zones.md §HTTP surface).
   */
  updateMetadata: (token: string, id: string, body: UpdateZoneMetadataRequest) =>
    request<ZoneDto>(`/admin/zones/${id}`, { method: 'PATCH', token, body }),

  /**
   * Creates a NEW VERSION and returns it — the old row stays, deactivated and superseded.
   *
   * `expected_version` is what turns two admins editing the same polygon in two tabs into one
   * save and one 409 `ZONE_ALREADY_SUPERSEDED`, rather than a silent last-write-wins. The UI
   * must render that 409 as "someone else saved this while you were editing", not as a generic
   * failure — losing an hour of boundary work to an unexplained toast is how people stop
   * trusting the editor.
   */
  updateGeometry: (token: string, id: string, body: UpdateZoneGeometryRequest) =>
    request<ZoneDto>(`/admin/zones/${id}/geometry`, { method: 'PATCH', token, body }),
};
