import type { Direction, UnavailableReason } from '@driverzone/contracts';
import type { IncityPackage, IncityVariant } from './domain/incityPackage.entity.js';
import type { OutstationPackage, OutstationVariant } from './domain/outstationPackage.entity.js';

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
  /**
   * Outstation only. Defaults to ONE_WAY; a round trip is an independent fare, not a 2×.
   *
   * There is no `carCategory` here any more. It was removed with per-category pricing on
   * 2026-08-28 (docs/decision-log.md): a package that matches this trip matches it for every
   * car. The category still travels with the BOOKING, because dispatch matches drivers on it —
   * it just no longer reaches this module.
   */
  direction?: Direction;
}

export interface IncityMatch {
  type: 'INCITY';
  package: IncityPackage;
  /**
   * ALL active variants, not one. The customer picks the duration, so the quote has to show
   * them every duration on offer.
   */
  variants: IncityVariant[];
}

export interface OutstationMatch {
  type: 'OUTSTATION';
  package: OutstationPackage;
  /** The band's fare for `direction`. Never null — a band that cannot sell it did not match. */
  farePaise: number;
  direction: Direction;
  variants: OutstationVariant[];
}

export type PackageMatch = IncityMatch | OutstationMatch;

/**
 * WHY THE LADDER LANDED WHERE IT DID — returned alongside every answer, match or not.
 *
 * In-city outranks outstation unconditionally, so a trip between two points a human would call
 * "in the city" that prices as an outstation run is never the ladder being wrong; it is one of
 * three facts about the DATA being different from what whoever drew the zones believed. Before
 * this, all three were indistinguishable from the outside and from the logs, and the only way to
 * tell them apart was to read the polygons by hand.
 *
 * A TRACE, NOT A DECISION. Nothing branches on it. `createQuote` logs it when a same-city trip
 * falls through, and the admin diagnostic renders it; neither changes what is charged.
 */
export interface ResolutionTrace {
  /** The city zone the PICKUP fell in, or null when it fell in none. */
  cityZoneId: string | null;
  /** Whether the DROP fell in that same city zone. In-city requires both. */
  toSameCityZone: boolean;
  terrain: 'PLAIN' | 'HILL';
  distanceKm: number;
  /** Active in-city packages found for that city zone, before the active-variant filter. */
  incityCandidates: number;
  /**
   * Why in-city did not win, or null when it did (or was never in the running because the two
   * points are not in one city, which `toSameCityZone` already says).
   */
  incityRejected: 'NOT_SAME_CITY' | 'NO_PACKAGE_FOR_CITY' | 'NO_ACTIVE_VARIANT' | null;
  /** Outstation bands covering this distance and terrain, before the direction filter. */
  outstationCandidates: number;
  outstationBandId: string | null;
}

export interface ResolutionResult {
  result: { available: true; match: PackageMatch } | Unavailable;
  trace: ResolutionTrace;
}

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

  /**
   * The same resolution, with the `ResolutionTrace` explaining it.
   *
   * A SECOND METHOD RATHER THAN A WIDER RETURN ON THE FIRST, because the two have different
   * audiences. `resolveForTrip` answers "what do I charge", is called on every quote, and its
   * callers have no business reading the trace. This one answers "why", and exists for the admin
   * diagnostic and the one log line that fires when a same-city trip does not price as in-city.
   * Both run the identical ladder — this is literally the function the other one delegates to —
   * so a diagnostic can never explain a decision the quote did not actually take.
   */
  explainForTrip(input: TripContext): Promise<ResolutionResult>;
}

export type PackagesPublicContract = PackageLookupContract;

export type { IncityPackage, IncityVariant } from './domain/incityPackage.entity.js';
export type { OutstationPackage, OutstationVariant } from './domain/outstationPackage.entity.js';
export { fareFor, driverAmountFor } from './domain/outstationPackage.entity.js';
export type { Direction };
