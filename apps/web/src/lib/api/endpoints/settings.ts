import type {
  GetSettingsResponse,
  PatchSettingsRequest,
  PatchSettingsResponse,
  ResetSettingsRequest,
  ResetSettingsResponse,
} from '@driverzone/contracts';
import { request } from '../client';

/**
 * `/admin/settings` — mirrors `apps/api/src/modules/settings/interface/settings.routes.ts`
 * one-for-one.
 *
 * MONEY HERE IS IN WHOLE RUPEES, not paise — the one deliberate exception to this API's paise
 * convention (docs/LLD/database-schema.md §Conventions). Nothing in this file or the screen above
 * it divides by 100, and `formatPaise` from `lib/format.ts` must never be pointed at one of these
 * values. Which fields are money is not guessed: every setting arrives carrying its own `unit`.
 *
 * READS TAKE A TRAILING `signal`; WRITES DO NOT — same rule as `endpoints/zones.ts`, for the same
 * reason.
 */
export const settingsApi = {
  list: (token: string, signal?: AbortSignal) =>
    request<GetSettingsResponse>('/admin/settings', { token, signal }),

  /**
   * ONE call for the whole page, not one per field.
   *
   * The server checks cross-key rules against the configuration the write would produce — the two
   * surcharge windows must not overlap, the cancellation ladder must not step down — so a batch
   * that is valid field-by-field can still be refused as a whole (422). Splitting the save into
   * per-field requests would make that check meaningless: each one would pass on its own and the
   * incoherent state would arrive anyway, one request at a time.
   *
   * No idempotency key: this is a PATCH that sets named keys to named values, so a replay writes
   * the same thing twice and lands in the same place.
   */
  update: (token: string, body: PatchSettingsRequest) =>
    request<PatchSettingsResponse>('/admin/settings', { method: 'PATCH', token, body }),

  /**
   * Drops overrides so the built-in defaults take over. Not the same as PATCHing the default
   * value back: that would store a row saying "deliberately 30", and a later change to the
   * shipped default would silently not reach this deployment.
   */
  reset: (token: string, body: ResetSettingsRequest) =>
    request<ResetSettingsResponse>('/admin/settings/reset', { method: 'POST', token, body }),
};
