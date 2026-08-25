/**
 * @driverzone/geo — geometry shared by the API (write guards, terrain classification) and the
 * web admin panel (live map-editor validation).
 *
 * One implementation, two callers. The admin editor showing a violation and the API rejecting
 * the save must never disagree, and the only reliable way to guarantee that is to run the
 * same code in both places.
 */
export {
  CoordinateError,
  assertPlausibleCoordinate,
  fromPosition,
  isPlausibleIndianCoordinate,
  toGeoJsonPoint,
  toPosition,
  type LatLng,
} from './coords.js';

/**
 * Re-exported so consumers never import the bare `geojson` package directly. It ships types
 * only (via `@types/geojson`, no runtime module on disk), which `apps/api`'s dependency-cruiser
 * cannot resolve the way `tsc` can — going through this already-resolvable workspace package
 * sidesteps that entirely, the same reasoning as every other type here.
 */
export type { LineString, Point, Polygon } from 'geojson';

export {
  checkMinimumArea,
  checkOverlap,
  checkValidity,
  checkWithinParent,
  clipToParent,
  validateZone,
  zoneStats,
  type NamedZone,
  type ViolationSeverity,
  type ZoneRule,
  type ZoneStats,
  type ZoneValidationInput,
  type ZoneViolation,
} from './zone-rules.js';

/**
 * `Terrain` is live — it is the outstation package matching key. `classifyTerrain` and
 * `hillMetresOnRoute` are dormant: terrain comes from `resolveAt(to).hill` now. See terrain.ts.
 */
export { classifyTerrain, hillMetresOnRoute, type Terrain } from './terrain.js';
