import type {
  ListZonesQuery,
  ListZonesResponse,
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
 * happens, and the editor will call it for live validation with the same code the API uses.
 */
export const zonesApi = {
  list: (token: string, query?: ListZonesQuery) =>
    request<ListZonesResponse>('/admin/zones', {
      token,
      // `parent_zone_id` is gone from the query: Z-1 is retired and a pickup zone is not a
      // child of anything (docs/decision-log.md, 2026-08-25). `ZoneDto` still carries the
      // field, dormant and always null.
      ...(query === undefined ? {} : { query: { type: query.type, is_active: query.is_active } }),
    }),

  get: (token: string, id: string) => request<ZoneDto>(`/admin/zones/${id}`, { token }),

  /**
   * Called on every geometry change while drawing, debounced ~400ms — never only on save
   * (docs/LLD/admin-panel.md §Live validation).
   */
  validate: (token: string, body: ValidateZoneRequest) =>
    request<ValidateZoneResponse>('/admin/zones/validate', { method: 'POST', token, body }),

  /**
   * Read BEFORE anything happens, to show the blast radius. Returns human-readable warnings
   * and never blocks — deactivation is always allowed, and the admin decides.
   */
  dependents: (token: string, id: string) =>
    request<ZoneDependentsResponse>(`/admin/zones/${id}/dependents`, { token }),

  /**
   * Soft-deactivate. `DELETE` here is not destructive: the zone stays for the bookings that
   * resolved against it, and the permanent removal is a separate route (`/hard`) that only
   * works once the zone is already inactive. Two verbs, two routes, on purpose.
   */
  deactivate: (token: string, id: string) =>
    request<ZoneDto>(`/admin/zones/${id}`, { method: 'DELETE', token }),
};
