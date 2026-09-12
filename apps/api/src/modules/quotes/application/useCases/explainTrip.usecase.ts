import type { LatLng } from '@driverzone/geo';
import type { Direction } from '@driverzone/contracts';
import type {
  PackageLookupContract,
  ResolutionTrace,
} from '../../../packages/packages.public.js';
import type { ZoneResolutionContract } from '../../../zones/zones.public.js';
import type { RoadDistancePort } from '../../domain/roadDistance.port.js';

export interface ExplainTripInput {
  pickup: LatLng;
  drop: LatLng;
  direction?: Direction | undefined;
}

/** One end of the trip, as the zone layer sees it. */
export interface ExplainedPoint {
  pickupZone: { id: string; name: string } | null;
  cityZone: { id: string; name: string } | null;
  hillZone: { id: string; name: string } | null;
}

export interface ExplainedTrip {
  from: ExplainedPoint;
  to: ExplainedPoint;
  /** Null when the pickup is not served, because the ladder stops before measuring anything. */
  distanceKm: number | null;
  /** Null when the trip never reached the package ladder — see `verdict`. */
  trace: ResolutionTrace | null;
  verdict: {
    serviceType: 'INCITY' | 'OUTSTATION' | null;
    packageId: string | null;
    packageName: string | null;
    /** The customer-facing reason when nothing can be sold. Null when something can. */
    unavailable: string | null;
  };
}

/**
 * APPLICATION — "why did this trip price the way it did", for an admin with two coordinates.
 *
 * WHY THIS EXISTS. In-city outranks outstation unconditionally and has since the distance guard
 * was retired, so "my in-city tour was charged as an outstation trip" is never the ladder being
 * wrong — it is one of three facts about the DATA: the drop fell outside the city polygon, the
 * pickup did, or that city has no in-city package with an active variant. All three produce the
 * identical customer-visible symptom, and before this the only way to tell them apart was to read
 * the polygons by hand.
 *
 * IN `quotes`, NOT `packages`, because this is the same composition `CreateQuoteUseCase` performs
 * — resolve both points, measure the road, ask the package ladder — and `packages` is deliberately
 * a tier below `zones` and knows nothing about coordinates. Putting it there would mean teaching
 * that module to resolve points, which is the coupling `TripContext` exists to avoid.
 *
 * IT RE-RUNS THE REAL LADDER rather than describing it. `explainForTrip` IS what `resolveForTrip`
 * delegates to, so a verdict here cannot differ from the one a customer would be quoted — which
 * is the whole value of the thing. It writes nothing: no quote row, no cache entry beyond the
 * road-distance one the shared adapter keeps anyway.
 */
export class ExplainTripUseCase {
  constructor(
    private readonly zones: ZoneResolutionContract,
    private readonly packages: PackageLookupContract,
    private readonly distance: RoadDistancePort,
  ) {}

  async execute(input: ExplainTripInput): Promise<ExplainedTrip> {
    const from = await this.zones.resolveAt(input.pickup);
    const to = await this.zones.resolveAt(input.drop);

    const fromPoint = describe(from);
    const toPoint = describe(to);

    if (from.pickup === null) {
      return {
        from: fromPoint,
        to: toPoint,
        distanceKm: null,
        trace: null,
        verdict: {
          serviceType: null,
          packageId: null,
          packageName: null,
          unavailable: 'We do not pick up from this location yet.',
        },
      };
    }

    const toSameCityZone = from.city !== null && to.city !== null && from.city.id === to.city.id;

    /*
     * ALWAYS MEASURES THE ROAD, unlike `CreateQuoteUseCase`, which deliberately skips the call
     * when an in-city package lands first because road distance is a paid API request per quote.
     * An admin looking at ONE trip is not that hot path, and the number they most want when a
     * short hop priced as an outstation band is the distance that chose the band.
     */
    const distanceKm = await this.distance.roadDistanceKm(input.pickup, input.drop);

    const { result, trace } = await this.packages.explainForTrip({
      ...(from.city === null ? {} : { fromCityZoneId: from.city.id }),
      toSameCityZone,
      toHillZone: to.hill !== null,
      distanceKm: distanceKm ?? 0,
      ...(input.direction === undefined ? {} : { direction: input.direction }),
    });

    if (!result.available) {
      return {
        from: fromPoint,
        to: toPoint,
        distanceKm,
        trace,
        verdict: {
          serviceType: null,
          packageId: null,
          packageName: null,
          unavailable: result.message,
        },
      };
    }

    return {
      from: fromPoint,
      to: toPoint,
      distanceKm,
      trace,
      verdict: {
        serviceType: result.match.type,
        packageId: result.match.package.id,
        packageName: result.match.package.name,
        unavailable: null,
      },
    };
  }
}

/** The three zones a point can be in, flattened to what a diagnostic screen needs to name them. */
function describe(resolved: {
  pickup: { id: string; name: string } | null;
  city: { id: string; name: string } | null;
  hill: { id: string; name: string } | null;
}): ExplainedPoint {
  return {
    pickupZone: resolved.pickup === null ? null : { id: resolved.pickup.id, name: resolved.pickup.name },
    cityZone: resolved.city === null ? null : { id: resolved.city.id, name: resolved.city.name },
    hillZone: resolved.hill === null ? null : { id: resolved.hill.id, name: resolved.hill.name },
  };
}
