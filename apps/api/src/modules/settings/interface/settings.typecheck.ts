import type { PatchSettingsRequest, ResetSettingsRequest } from '@driverzone/contracts';
import type { Rupees } from '../domain/money.js';
import type { PatchSettingsInput, ResetSettingsInput } from './settings.validation.js';

/**
 * Compile-only drift guard between the Zod schemas and the shared wire types.
 *
 * See `zones/interface/zones.typecheck.ts` for the full rationale — same mechanism, this
 * module's shapes. Imported by nothing, emits nothing; exists so `tsc --noEmit` fails when
 * `settings.validation.ts` and `@driverzone/contracts` disagree about a request shape.
 *
 * Only the two REQUEST bodies are guarded. The response DTOs are assembled from the registry in
 * `listSettings.usecase.ts` against the imported `SettingGroupDto`, so TypeScript already checks
 * those at the point they are built — there is nothing here for them to drift from.
 */

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;

export type PatchSettingsMatches = AssertTrue<Exact<PatchSettingsInput, PatchSettingsRequest>>;
export type ResetSettingsMatches = AssertTrue<Exact<ResetSettingsInput, ResetSettingsRequest>>;

/**
 * `Rupees` must NOT be assignable to `number`, or the whole point of it is gone.
 *
 * Pinned here rather than in a test because the guarantee is a compile error and `tsc --noEmit`
 * does not read `test/`. It also pins the specific mistake that was made and caught while writing
 * this module: `number & { __unit: 'RUPEES' }` — the standard branded-number recipe — passes an
 * assignability check in one direction and still lets `baseFarePaise + insuranceCharge` compile,
 * which is the direction that costs money. If this line ever starts failing, someone has
 * "simplified" `domain/money.ts` back into an intersection.
 */
export type RupeesIsNotSilentlyANumber = AssertTrue<
  Exact<Rupees extends number ? true : false, false>
>;
