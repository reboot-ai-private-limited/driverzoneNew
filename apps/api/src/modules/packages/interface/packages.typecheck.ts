import type {
  CreateIncityPackageRequest,
  CreateOutstationPackageRequest,
  IncityPackageDto,
  ListIncityPackagesQuery,
  ListOutstationPackagesQuery,
  OutstationPackageDto,
  Terrain as ContractTerrain,
  UpdateIncityPackageRequest,
  UpdateOutstationPackageRequest,
} from '@driverzone/contracts';
import type { Terrain as GeoTerrain } from '@driverzone/geo';
import type { toIncityPackageDto, toOutstationPackageDto } from './packages.mapper.js';
import type {
  CreateIncityPackageBody,
  CreateOutstationPackageBody,
  ListOutstationQueryInput,
  ListPackagesQueryInput,
  UpdateIncityPackageBody,
  UpdateOutstationPackageBody,
} from './packages.validation.js';

/**
 * Compile-only drift guard between this module's Zod schemas, its DTO mapper, and the shared
 * wire types. See `zones/interface/zones.typecheck.ts` for the full rationale.
 *
 * Imported by nothing and emitting nothing, it exists so `tsc --noEmit` fails when
 * `packages.validation.ts`, `packages.mapper.ts` and `@driverzone/contracts` stop agreeing.
 *
 * It is here specifically because they had already stopped agreeing and nothing noticed: the
 * controllers were serialising camelCase domain entities against snake_case DTOs, which broke
 * the zones screen's package count for as long as the mismatch stood. The mapper fixes today's
 * instance; this file is what makes the next one a build failure instead of a silent zero.
 */

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;

// ─── Requests: what Zod accepts must be exactly what the contract promises ────────────────────

export type CreateIncityMatches = AssertTrue<
  Exact<CreateIncityPackageBody, CreateIncityPackageRequest>
>;
export type UpdateIncityMatches = AssertTrue<
  Exact<UpdateIncityPackageBody, UpdateIncityPackageRequest>
>;
export type CreateOutstationMatches = AssertTrue<
  Exact<CreateOutstationPackageBody, CreateOutstationPackageRequest>
>;
export type UpdateOutstationMatches = AssertTrue<
  Exact<UpdateOutstationPackageBody, UpdateOutstationPackageRequest>
>;

/**
 * The list QUERIES are deliberately not pinned to each other, and the reason is worth recording
 * rather than quietly omitting.
 *
 * `ListIncityPackagesQuery` in the contract is snake_case, because it is the object a CALLER
 * builds; the query string this API actually parses is camelCase (`?isActive=true`), and
 * `apps/web/src/lib/api/endpoints/packages.ts` translates between them at the one place that
 * knows both. An `Exact` assertion between the two would therefore always be false, and
 * "fixing" it by renaming either side breaks the other. What IS pinned is the value type: both
 * are a real boolean, because the schema parses the literal `'true'`/`'false'` rather than
 * using `z.coerce.boolean()`, which reads `'false'` as true.
 */
type QueryValueTypes = {
  incity: ListPackagesQueryInput['isActive'];
  outstation: ListOutstationQueryInput['terrain'];
};
export type QueryValuesMatch = AssertTrue<
  Exact<QueryValueTypes, {
    incity: ListIncityPackagesQuery['is_active'];
    outstation: ListOutstationPackagesQuery['terrain'];
  }>
>;

// ─── Responses: what the mapper builds must be exactly what the contract promises ─────────────

export type IncityDtoMatches = AssertTrue<Exact<ReturnType<typeof toIncityPackageDto>, IncityPackageDto>>;
export type OutstationDtoMatches = AssertTrue<
  Exact<ReturnType<typeof toOutstationPackageDto>, OutstationPackageDto>
>;

/**
 * `Terrain` is declared twice on purpose — in `@driverzone/geo` where the zone rules use it, and
 * in `@driverzone/contracts` where the web app can reach it without depending on `geo`. Two
 * declarations of one union is exactly the thing that drifts, so pin them.
 */
export type TerrainDeclarationsAgree = AssertTrue<Exact<ContractTerrain, GeoTerrain>>;
