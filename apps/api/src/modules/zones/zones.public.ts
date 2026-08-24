import type { LatLng, LineString } from '@driverzone/geo';
import type { ActorContext } from './application/actorContext.js';
import type { CreateZoneInput } from './application/useCases/createZone.usecase.js';
import type { UpdateZoneGeometryInput } from './application/useCases/updateZoneGeometry.usecase.js';
import type {
  ValidateZoneGeometryInput,
  ValidateZoneGeometryResult,
} from './application/useCases/validateZoneGeometry.usecase.js';
import type { DeactivateZoneInput } from './application/useCases/deactivateZone.usecase.js';
import type { ZoneDependents } from './application/useCases/getZoneDependents.usecase.js';
import type { ResolvedZones, Zone } from './domain/zone.entity.js';
import type { ZoneListFilter } from './domain/zone.repository.port.js';

/**
 * PUBLIC CONTRACT — the only surface other modules may import from `zones`.
 *
 * Split by consumer, not by entity (docs/engineering/adding-a-module.md's worked example for
 * this exact module): a future `dispatch` handed only `ZoneResolutionContract` is structurally
 * incapable of writing a polygon, which is what makes `CreateZoneUseCase` an actual invariant
 * guarantee rather than a convention.
 *
 * Re-uses the use cases' own Input/Result types rather than redeclaring them inline (unlike
 * `identity.public.ts`'s small hand-written shapes) — this module has enough admin methods that
 * a second, hand-copied shape per method would drift from the real one in practice, and every
 * type reused here is already domain-shaped, not an HTTP DTO, so nothing wire-specific leaks
 * across the boundary.
 */

/** Read-only resolution — the hot path, every quote calls this. */
export interface ZoneResolutionContract {
  resolveAt(point: LatLng): Promise<ResolvedZones>;
  /** Geometry only — no terrain verdict. See `findHillZonesForRoute.usecase.ts` for why. */
  findHillZonesNear(route: LineString): Promise<Zone[]>;
}

/** Zone authoring — admin only, and the only path that may write a polygon. */
export interface ZoneAdminContract {
  create(input: CreateZoneInput, actor: ActorContext): Promise<Zone>;
  updateGeometry(zoneId: string, input: UpdateZoneGeometryInput, actor: ActorContext): Promise<Zone>;
  deactivate(zoneId: string, input: DeactivateZoneInput, actor: ActorContext): Promise<Zone>;
  delete(zoneId: string, actor: ActorContext): Promise<void>;
  /** Dry run — no write. Backs `POST /admin/zones/validate` and the live editor. */
  validate(input: ValidateZoneGeometryInput): Promise<ValidateZoneGeometryResult>;
  getDependents(zoneId: string): Promise<ZoneDependents>;
  list(filter: ZoneListFilter): Promise<Zone[]>;
  get(zoneId: string): Promise<Zone>;
}

/**
 * The whole surface, as returned by `buildZonesContainer()`. No consumer modules exist yet to
 * split delivery of one half vs the other, but keeping the two interfaces separate now avoids a
 * breaking change later when `dispatch` should only ever receive `ZoneResolutionContract`.
 */
export type ZonesPublicContract = ZoneResolutionContract & ZoneAdminContract;
