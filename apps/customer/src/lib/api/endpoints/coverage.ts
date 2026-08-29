import type { CoverageCheckQuery, CoverageCheckResponse } from '@driverzone/contracts';
import { request } from '../client';

/**
 * `GET /coverage/check` — apps/api/src/modules/zones/interface/customer.routes.ts.
 *
 * Two things about this endpoint are easy to get wrong, and both are why it has its own file:
 *
 *   - It is mounted at `/coverage`, NOT under `ROLE_PREFIX`. Every other call in this folder is
 *     a `/customer/*` route; this one is not, and prefixing it produces a 404 that reads like a
 *     server fault.
 *   - It is UNAUTHENTICATED, so no bearer is attached. Coverage is a fact about a place, not
 *     about a customer, and the home screen asks before the profile query has resolved.
 *
 * A place we do not serve answers `200` with `covered: false` — never a 404. See
 * docs/LLD/zone-resolution.md §Error codes.
 */
export function checkCoverage(query: CoverageCheckQuery): Promise<CoverageCheckResponse> {
  return request<CoverageCheckResponse>('/coverage/check', {
    query: { lat: query.lat, lng: query.lng },
  });
}
