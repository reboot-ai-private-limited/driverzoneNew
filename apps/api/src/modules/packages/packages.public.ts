import type { UnavailableReason } from '@driverzone/contracts';
import type { IncityPackage, IncityVariant } from './domain/incityPackage.entity.js';
import type { OutstationPackage, OutstationPrice } from './domain/outstationPackage.entity.js';

/**
 * PUBLIC CONTRACT — the only surface other modules may import from `packages`.
 *
 * Read-only, deliberately. `quotes` is the consumer this exists for, and it must be
 * structurally incapable of writing a package: the band-overlap guard (P-2) and the
 * has-an-active-price guard (P-3) live in the admin use cases, and a second write path would
 * make both of them a convention rather than a guarantee. The admin CRUD is reachable over
 * HTTP and nowhere else. When a module genuinely needs to author a package, add a separate
 * `PackageAdminContract` here rather than widening this one.
 *
 * `TripContext` is scalars, not zone objects, and that is what keeps this module off `zones`:
 * the caller has already run `zones.resolveAt()` for its own reasons, so it passes down what it
 * learned instead of making this module resolve the same points again a tier lower.
 */

export interface TripContext {
  /** The city zone id if the pickup point is inside a city zone. */
  fromCityZoneId?: string;
  /** True if the drop point is inside that same city zone. */
  toSameCityZone: boolean;
  /**
   * True if the drop point is inside a HILL zone. Terrain is a property of the DESTINATION,
   * never of the route — see docs/LLD/packages.md §Terrain for why route measurement was
   * retired.
   */
  toHillZone: boolean;
  /**
   * Road distance in kilometres — OSRM, not haversine. Straight-line under-reports by 30–50%
   * in hill terrain, which with 25–30 km bands puts trips in the wrong band constantly.
   */
  distanceKm: number;
  /** The requested car category id. */
  carCategoryId: string;
  /** Outstation only. Defaults to ONE_WAY; a round trip is an independent price row, not a 2×. */
  direction?: 'ONE_WAY' | 'ROUND_TRIP';
}

export interface IncityMatch {
  type: 'INCITY';
  package: IncityPackage;
  /**
   * ALL active variants holding an active price for the car category, not one. The customer
   * picks the duration, so the quote has to show them every duration on offer.
   */
  variants: IncityVariant[];
}

export interface OutstationMatch {
  type: 'OUTSTATION';
  package: OutstationPackage;
  /** Exactly one row, for `(carCategoryId, direction)`. */
  price: OutstationPrice;
}

export type PackageMatch = IncityMatch | OutstationMatch;

/**
 * NOT an error. "We can't serve this" is a 200 with `available: false` — see
 * docs/engineering/coding-standards.md §"Unavailable" is not an error. `code` is narrowed from
 * the shared `UnavailableReason` union because the zone-side reasons are decided before this
 * module is ever called.
 */
export interface Unavailable {
  available: false;
  code: Extract<UnavailableReason, 'NO_PACKAGE_AVAILABLE' | 'NO_PACKAGE_FOR_DISTANCE'>;
  message: string;
}

/** Read-only. `quotes` calls this; it cannot write a package. */
export interface PackageLookupContract {
  /**
   * Exactly ONE package, or a typed reason why none applies. Never a list for the caller to
   * rank: the precedence ladder is this module's rule, and a caller applying it independently
   * is a caller that will eventually apply it differently (docs/LLD/packages.md §Resolution).
   */
  resolveForTrip(input: TripContext): Promise<{ available: true; match: PackageMatch } | Unavailable>;
}

export type PackagesPublicContract = PackageLookupContract;

export type {
  IncityPackage,
  IncityVariant,
  IncityPrice,
  CommissionType,
} from './domain/incityPackage.entity.js';
export type { OutstationPackage, OutstationPrice, Direction } from './domain/outstationPackage.entity.js';
