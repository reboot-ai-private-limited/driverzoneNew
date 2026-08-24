import type {
  CoverageCheckQuery,
  CreateZoneRequest,
  DeactivateZoneRequest,
  ListZonesQuery,
  UpdateZoneGeometryRequest,
  ValidateZoneRequest,
} from '@driverzone/contracts';
import type {
  CoverageCheckQueryInput,
  CreateZoneInput,
  DeactivateZoneInput,
  ListZonesQueryInput,
  UpdateZoneGeometryInput,
  ValidateZoneInput,
} from './zones.validation.js';

/**
 * Compile-only drift guard between the Zod schemas and the shared wire types.
 *
 * See `identity/interface/identity.typecheck.ts` for the full rationale — same mechanism, this
 * module's shapes. Imported by nothing, emits nothing; exists so `tsc --noEmit` fails when
 * `zones.validation.ts` and `@driverzone/contracts` disagree about a request shape.
 */

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;

export type CreateZoneMatches = AssertTrue<Exact<CreateZoneInput, CreateZoneRequest>>;
export type UpdateZoneGeometryMatches = AssertTrue<
  Exact<UpdateZoneGeometryInput, UpdateZoneGeometryRequest>
>;
export type ValidateZoneMatches = AssertTrue<Exact<ValidateZoneInput, ValidateZoneRequest>>;
export type DeactivateZoneMatches = AssertTrue<
  Exact<DeactivateZoneInput, DeactivateZoneRequest>
>;
export type ListZonesQueryMatches = AssertTrue<Exact<ListZonesQueryInput, ListZonesQuery>>;
export type CoverageCheckQueryMatches = AssertTrue<
  Exact<CoverageCheckQueryInput, CoverageCheckQuery>
>;
