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
      ...(query === undefined
        ? {}
        : {
            query: {
              type: query.type,
              parent_zone_id: query.parent_zone_id,
              is_active: query.is_active,
            },
          }),
    }),

  get: (token: string, id: string) => request<ZoneDto>(`/admin/zones/${id}`, { token }),

  /**
   * Called on every geometry change while drawing, debounced ~400ms — never only on save
   * (docs/LLD/admin-panel.md §Live validation).
   */
  validate: (token: string, body: ValidateZoneRequest) =>
    request<ValidateZoneResponse>('/admin/zones/validate', { method: 'POST', token, body }),

  /** Read BEFORE anything happens, to show the blast radius. */
  dependents: (token: string, id: string) =>
    request<ZoneDependentsResponse>(`/admin/zones/${id}/dependents`, { token }),
};
