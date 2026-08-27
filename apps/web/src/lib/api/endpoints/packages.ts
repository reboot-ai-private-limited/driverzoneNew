import type { ListIncityPackagesQuery, ListIncityPackagesResponse } from '@driverzone/contracts';
import { request } from '../client';

/**
 * `/admin/packages` — mirrors `apps/api/src/modules/packages/interface/packages.routes.ts`.
 *
 * READS ONLY, for now. The packages screen is not built; the zones screen reads this list to
 * answer one question on the city card — how many packages sell against this city zone — and
 * the writes land with the editor that needs them.
 */
export const packagesApi = {
  listIncity: (token: string, query?: ListIncityPackagesQuery, signal?: AbortSignal) =>
    request<ListIncityPackagesResponse>('/admin/packages/incity', {
      token,
      signal,
      // The API reads this as the string 'true'/'false' — `z.coerce.boolean()` would take
      // 'false' for true, so the schema uses an enum and the client must send a real boolean
      // for `request` to stringify.
      ...(query?.is_active === undefined ? {} : { query: { isActive: query.is_active } }),
    }),
};
