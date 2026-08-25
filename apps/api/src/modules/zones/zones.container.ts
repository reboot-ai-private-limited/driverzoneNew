import type { Router } from 'express';
import { CheckCoverageUseCase } from './application/useCases/checkCoverage.usecase.js';
import { CreateZoneUseCase } from './application/useCases/createZone.usecase.js';
import { DeactivateZoneUseCase } from './application/useCases/deactivateZone.usecase.js';
import { DeleteZoneUseCase } from './application/useCases/deleteZone.usecase.js';
import { FindHillZonesForRouteUseCase } from './application/useCases/findHillZonesForRoute.usecase.js';
import { GetZoneUseCase } from './application/useCases/getZone.usecase.js';
import { GetZoneDependentsUseCase } from './application/useCases/getZoneDependents.usecase.js';
import { ListZonesUseCase } from './application/useCases/listZones.usecase.js';
import { ResolveZonesAtPointUseCase } from './application/useCases/resolveZonesAtPoint.usecase.js';
import { UpdateZoneGeometryUseCase } from './application/useCases/updateZoneGeometry.usecase.js';
import { UpdateZoneMetadataUseCase } from './application/useCases/updateZoneMetadata.usecase.js';
import { ValidateZoneGeometryUseCase } from './application/useCases/validateZoneGeometry.usecase.js';
import { ZonesAuditLog } from './infrastructure/audit.zones.js';
import { MongoZoneRepository } from './infrastructure/zone.repository.impl.js';
import { makeAdminControllers } from './interface/admin.controller.js';
import { buildAdminRouter } from './interface/admin.routes.js';
import { makeCustomerControllers } from './interface/customer.controller.js';
import { buildCoverageRouter } from './interface/customer.routes.js';
import { registerZonesSwaggerPaths } from './interface/zones.swagger.js';
import type { ZonesPublicContract } from './zones.public.js';

/**
 * THE COMPOSITION ROOT for this module — the one file allowed to name concrete classes.
 *
 * Two router builders rather than one `buildRouter()`: unlike `identity` (one role router per
 * consumer) this module has two route surfaces with unrelated mount points —
 * `/admin/zones` and `/coverage` — so `routes.ts` needs to mount each at its own prefix. Both
 * are still functions, not eager properties, for the same reason as `health`/`identity`: the
 * worker builds every container for its contract and serves no HTTP.
 *
 * `FindHillZonesForRouteUseCase` is wired but DORMANT — nothing calls it through the contract's
 * real consumers, since terrain is decided by `resolveAt(to).hill` now. Kept for the same reason
 * `checkWithinParent` is kept in `@driverzone/geo`: reviving it is a wiring change, not a rewrite.
 */
export interface ZonesContainer {
  contract: ZonesPublicContract;
  buildAdminRouter: () => Router;
  buildCoverageRouter: () => Router;
}

export function buildZonesContainer(): ZonesContainer {
  // A side effect of building this module, same as constructing its repository or its routes —
  // registers this module's OpenAPI paths against the shared registry in
  // `@/shared/http/swagger.util.js`. `shared/` cannot import a module (`shared-is-below-modules`
  // in `.dependency-cruiser.cjs`), so the registration has to be triggered from inside the
  // module itself rather than pulled in from outside.
  registerZonesSwaggerPaths();

  const zones = new MongoZoneRepository();
  const audit = new ZonesAuditLog();

  const resolveZonesAtPoint = new ResolveZonesAtPointUseCase(zones);
  const findHillZonesForRoute = new FindHillZonesForRouteUseCase(zones);
  const createZone = new CreateZoneUseCase(zones, audit);
  const updateZoneGeometry = new UpdateZoneGeometryUseCase(zones, audit);
  const updateZoneMetadata = new UpdateZoneMetadataUseCase(zones, audit);
  const validateZoneGeometry = new ValidateZoneGeometryUseCase(zones);
  const deactivateZone = new DeactivateZoneUseCase(zones, audit);
  const deleteZone = new DeleteZoneUseCase(zones, audit);
  const getZoneDependents = new GetZoneDependentsUseCase(zones);
  const listZones = new ListZonesUseCase(zones);
  const getZone = new GetZoneUseCase(zones);
  const checkCoverage = new CheckCoverageUseCase(resolveZonesAtPoint);

  return {
    contract: {
      resolveAt: (point) => resolveZonesAtPoint.execute(point),
      findHillZonesNear: (route) => findHillZonesForRoute.execute(route),
      create: (input, actor) => createZone.execute(input, actor),
      updateGeometry: (zoneId, input, actor) => updateZoneGeometry.execute(zoneId, input, actor),
      updateMetadata: (zoneId, input, actor) => updateZoneMetadata.execute(zoneId, input, actor),
      deactivate: (zoneId, actor) => deactivateZone.execute(zoneId, actor),
      delete: (zoneId, actor) => deleteZone.execute(zoneId, actor),
      validate: (input) => validateZoneGeometry.execute(input),
      getDependents: (zoneId) => getZoneDependents.execute(zoneId),
      list: (filter) => listZones.execute(filter),
      get: (zoneId) => getZone.execute(zoneId),
    },

    buildAdminRouter: () =>
      buildAdminRouter(
        makeAdminControllers({
          create: createZone,
          updateGeometry: updateZoneGeometry,
          updateMetadata: updateZoneMetadata,
          validate: validateZoneGeometry,
          deactivate: deactivateZone,
          delete: deleteZone,
          getDependents: getZoneDependents,
          list: listZones,
          get: getZone,
        }),
      ),

    buildCoverageRouter: () => buildCoverageRouter(makeCustomerControllers({ checkCoverage })),
  };
}
