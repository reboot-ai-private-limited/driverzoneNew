import type { Direction } from '@driverzone/contracts';
import type {
  TripContext,
  PackageMatch,
  ResolutionResult,
  ResolutionTrace,
  Unavailable,
} from '../../packages.public.js';
import type { PackageRepositoryPort } from '../../domain/packageRepository.port.js';
import type { IncityPackage } from '../../domain/incityPackage.entity.js';
import { fareFor, type OutstationPackage } from '../../domain/outstationPackage.entity.js';

/**
 * The precedence ladder from docs/LLD/packages.md §Resolution. The customer supplies two points
 * and a direction; this returns exactly ONE package or a typed reason why none applies.
 *
 * The per-car-category filtering that used to run at every rung is gone: price no longer varies
 * by category (docs/decision-log.md, 2026-08-28), so a package that matches the trip matches it
 * for everyone. What replaced it, on the outstation side, is a DIRECTION check — a band may
 * decline to sell a return trip.
 */
export class ResolveForTripUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  /**
   * The answer alone — what every quote asks for.
   *
   * Delegates to `explain` rather than the other way round, so there is exactly one copy of the
   * ladder and the diagnostic cannot describe a decision this never takes.
   */
  async execute(input: TripContext): Promise<{ available: true; match: PackageMatch } | Unavailable> {
    return (await this.explain(input)).result;
  }

  async explain(input: TripContext): Promise<ResolutionResult> {
    // 3. build the candidate set
    let incityCandidates: IncityPackage[] = [];
    if (input.fromCityZoneId && input.toSameCityZone) {
      incityCandidates = await this.repo.findIncityForQuote({ cityZoneId: input.fromCityZoneId });
    }

    const terrain = input.toHillZone ? 'HILL' : 'PLAIN';
    const outstationCandidates = await this.repo.findOutstationForQuote({
      terrain,
      distanceKm: input.distanceKm,
    });

    const validIncity = incityCandidates.filter((pkg) => pkg.variants.some((v) => v.isActive));

    const direction: Direction = input.direction ?? 'ONE_WAY';
    /**
     * A band whose `roundTripFarePaise` is null does not sell that direction. It is not a
     * candidate, and if nothing else matches the answer is `NO_PACKAGE_AVAILABLE` rather than
     * `NO_PACKAGE_FOR_DISTANCE`: the distance IS covered, and sending ops off to add a band that
     * already exists would be the wrong instruction.
     */
    const validOutstation = outstationCandidates.filter((pkg) => fareFor(pkg, direction) !== null);

    /*
     * WHY IN-CITY IS NOT IN THE RUNNING, in the three ways it can fail to be. Built here, beside
     * the filters it describes, rather than re-derived later from the result — a trace inferred
     * from the answer is a trace that can disagree with the reason.
     */
    const incityRejected: ResolutionTrace['incityRejected'] =
      validIncity.length > 0
        ? null
        : !input.toSameCityZone || input.fromCityZoneId === undefined
          ? 'NOT_SAME_CITY'
          : incityCandidates.length === 0
            ? 'NO_PACKAGE_FOR_CITY'
            : 'NO_ACTIVE_VARIANT';

    const trace: ResolutionTrace = {
      cityZoneId: input.fromCityZoneId ?? null,
      toSameCityZone: input.toSameCityZone,
      terrain,
      distanceKm: input.distanceKm,
      incityCandidates: incityCandidates.length,
      incityRejected,
      outstationCandidates: outstationCandidates.length,
      outstationBandId: null,
    };

    if (validIncity.length === 0 && validOutstation.length === 0) {
      if (
        outstationCandidates.length === 0 &&
        (!input.toSameCityZone || incityCandidates.length === 0)
      ) {
        return {
          trace,
          result: {
            available: false,
            code: 'NO_PACKAGE_FOR_DISTANCE',
            message: 'No band covers this distance for this terrain',
          },
        };
      }
      return {
        trace,
        result: {
          available: false,
          code: 'NO_PACKAGE_AVAILABLE',
          message: 'No package configured',
        },
      };
    }

    /**
     * 4a. INCITY BEATS OUTSTATION, UNCONDITIONALLY.
     *
     * There used to be a distance guard here: incity won only if the trip fitted within
     * `incity.max_distance_multiple` × the longest variant's `includedKm`, so a 60 km drop that
     * happened to land inside the city polygon fell through and priced as the outstation run it
     * plainly was. `includedKm` was removed 2026-08-28 and the guard was dropped with it rather
     * than re-expressed as a flat km limit (docs/decision-log.md).
     *
     * The accepted cost: both points inside the city zone now means incity at ANY distance, and
     * with no overage there is nothing to collect the difference on a long cross-city run. That
     * is a deliberate call, recorded in the log, and not something to re-add here quietly.
     */
    const selectedIncity = this.getBestIncity(validIncity);
    if (selectedIncity) {
      return { trace, result: { available: true, match: this.incityMatch(selectedIncity) } };
    }

    // b. HILL beats PLAIN (handled by terrain logic)
    // c & d. lower fare for THIS request / most recently created
    const selectedOutstation = this.getBestOutstation(validOutstation, direction);
    if (selectedOutstation) {
      // `validOutstation` was filtered on exactly this predicate, so the fare is there. Narrowed
      // rather than asserted with `!` — coding-standards.md bans the assertion, and if the two
      // predicates ever drift this returns "nothing to sell" instead of a null fare.
      const farePaise = fareFor(selectedOutstation, direction);
      if (farePaise !== null) {
        return {
          trace: { ...trace, outstationBandId: selectedOutstation.id },
          result: {
            available: true,
            match: {
              type: 'OUTSTATION',
              package: selectedOutstation,
              farePaise,
              direction,
              variants: (selectedOutstation.variants ?? []).filter((v) => v.isActive),
            },
          },
        };
      }
    }

    return {
      trace,
      result: {
        available: false,
        code: 'NO_PACKAGE_AVAILABLE',
        message: 'No package configured',
      },
    };
  }

  /** ALL active variants, not one: the customer picks the duration, so the quote shows them all. */
  private incityMatch(pkg: IncityPackage): PackageMatch {
    return {
      type: 'INCITY',
      package: pkg,
      variants: pkg.variants.filter((v) => v.isActive),
    };
  }

  /**
   * Rung (c), then (d). Compare on the cheapest active variant — the closest thing to "the total
   * for this request" available without the `pricing` module — then most recently created, then
   * whatever order the store returned. Never resolve an ambiguity toward charging more.
   */
  private getBestIncity(packages: IncityPackage[]): IncityPackage | null {
    if (packages.length === 0) return null;
    return (
      [...packages].sort((a, b) => {
        const aCheapest = Math.min(...a.variants.filter((v) => v.isActive).map((v) => v.baseFarePaise));
        const bCheapest = Math.min(...b.variants.filter((v) => v.isActive).map((v) => v.baseFarePaise));
        if (aCheapest !== bCheapest) return aCheapest - bCheapest;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })[0] ?? null
    );
  }

  private getBestOutstation(
    packages: OutstationPackage[],
    direction: Direction,
  ): OutstationPackage | null {
    if (packages.length === 0) return null;
    return (
      [...packages].sort((a, b) => {
        const aFare = fareFor(a, direction) ?? Infinity;
        const bFare = fareFor(b, direction) ?? Infinity;
        if (aFare !== bFare) return aFare - bFare;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })[0] ?? null
    );
  }
}
