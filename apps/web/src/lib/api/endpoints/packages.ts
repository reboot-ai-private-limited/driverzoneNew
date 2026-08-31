import type {
  CreateIncityPackageRequest,
  CreateOutstationPackageRequest,
  IncityPackageDto,
  ListIncityPackagesQuery,
  ListIncityPackagesResponse,
  ListOutstationPackagesQuery,
  ListOutstationPackagesResponse,
  OutstationPackageDto,
  UpdateIncityPackageRequest,
  UpdateOutstationPackageRequest,
} from '@driverzone/contracts';
import { request } from '../client';

/**
 * `/admin/packages` — mirrors `apps/api/src/modules/packages/interface/packages.routes.ts`.
 *
 * READS TAKE A TRAILING `signal`; WRITES DO NOT — the same rule as `endpoints/zones.ts` and
 * `endpoints/customers.ts`.
 *
 * Two shapes here are the API's, not this file's preference, and both are load-bearing:
 *
 *  - **The updates are `PUT`, not `PATCH`,** and the handler REPLACES the nested `variants` /
 *    `prices` arrays rather than merging into them. A caller sending a shortened array deletes
 *    the rest, so the editor submits the whole thing every time. The changed-fields-only
 *    `buildPatch` idiom from `endpoints/customers.ts` does not apply here.
 *  - **There is no DELETE.** Removing a package is `PUT { isActive: false }`. A band that has
 *    ever priced a booking is referenced by that booking's fare snapshot; deleting the row would
 *    orphan it.
 *
 * The request bodies are camelCase while the responses are snake_case. That asymmetry is the
 * API's (see the header of `packages/contracts/src/packages.ts`); this file does not paper over
 * it, because a translation layer here would be a second place for the shapes to drift.
 */
export const packagesApi = {
  listIncity: (token: string, query?: ListIncityPackagesQuery, signal?: AbortSignal) =>
    request<ListIncityPackagesResponse>('/admin/packages/incity', {
      token,
      signal,
      // The API reads this as the string 'true'/'false' — `z.coerce.boolean()` would take
      // 'false' for true, so the schema uses an enum and the client must send a real boolean
      // for `request` to stringify. The param is camelCase on the wire; the query object is
      // snake_case like every other one, and this is the single place that knows both.
      ...(query?.is_active === undefined ? {} : { query: { isActive: query.is_active } }),
    }),

  getIncity: (token: string, id: string, signal?: AbortSignal) =>
    request<IncityPackageDto>(`/admin/packages/incity/${id}`, { token, signal }),

  createIncity: (token: string, body: CreateIncityPackageRequest, idempotencyKey: string) =>
    request<IncityPackageDto>('/admin/packages/incity', {
      method: 'POST',
      token,
      body,
      idempotencyKey,
    }),

  /** No idempotency key: a PUT is idempotent by construction — replaying it changes nothing. */
  updateIncity: (token: string, id: string, body: UpdateIncityPackageRequest) =>
    request<IncityPackageDto>(`/admin/packages/incity/${id}`, { method: 'PUT', token, body }),

  listOutstation: (token: string, query?: ListOutstationPackagesQuery, signal?: AbortSignal) =>
    request<ListOutstationPackagesResponse>('/admin/packages/outstation', {
      token,
      signal,
      ...(query === undefined
        ? {}
        : { query: { isActive: query.is_active, terrain: query.terrain } }),
    }),

  getOutstation: (token: string, id: string, signal?: AbortSignal) =>
    request<OutstationPackageDto>(`/admin/packages/outstation/${id}`, { token, signal }),

  createOutstation: (token: string, body: CreateOutstationPackageRequest, idempotencyKey: string) =>
    request<OutstationPackageDto>('/admin/packages/outstation', {
      method: 'POST',
      token,
      body,
      idempotencyKey,
    }),

  updateOutstation: (token: string, id: string, body: UpdateOutstationPackageRequest) =>
    request<OutstationPackageDto>(`/admin/packages/outstation/${id}`, {
      method: 'PUT',
      token,
      body,
    }),
};
