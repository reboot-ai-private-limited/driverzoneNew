import type { Direction } from '@driverzone/contracts';
import type { TripContext, PackageMatch, Unavailable } from '../../packages.public.js';
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
 * decline to sell a same-day return.
 */
export class ResolveForTripUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  async execute(input: TripContext): Promise<{ available: true; match: PackageMatch } | Unavailable> {
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

    if (validIncity.length === 0 && validOutstation.length === 0) {
      if (
        outstationCandidates.length === 0 &&
        (!input.toSameCityZone || incityCandidates.length === 0)
      ) {
        return {
          available: false,
          code: 'NO_PACKAGE_FOR_DISTANCE',
          message: 'No band covers this distance for this terrain',
        };
      }
      return {
        available: false,
        code: 'NO_PACKAGE_AVAILABLE',
        message: 'No package configured',
      };
    }

    // 4. precedence
    // a. INCITY beats OUTSTATION (with guard)
    const selectedIncity = this.getBestIncity(validIncity);

    if (selectedIncity) {
      const maxIncludedKm = Math.max(...selectedIncity.variants.map((v) => v.includedKm));
      /**
       * The guard on rung (a). A 60 km drop that happens to land inside the city polygon
       * matches both an incity package and an outstation band; preferring incity blindly sells
       * an hourly rental for what is plainly an outstation run. Beyond this multiple of the
       * longest variant's included km, incity stops being a candidate at all.
       *
       * TODO: read this from `settings`. The module now exists, but `incity.max_distance_multiple`
       * is deliberately not one of its keys yet (docs/decision-log.md, 2026-08-28): a key is added
       * when the code reading it is written, and taking a dependency on `settings` from here to
       * fetch a single constant is not worth the wiring until the pricing work lands. Until then
       * ops cannot tune this without a deploy.
       */
      const MAX_DISTANCE_MULTIPLE = 2;
      if (input.distanceKm <= maxIncludedKm * MAX_DISTANCE_MULTIPLE) {
        return { available: true, match: this.incityMatch(selectedIncity) };
      }
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
          available: true,
          match: { type: 'OUTSTATION', package: selectedOutstation, farePaise, direction },
        };
      }
    }

    if (selectedIncity) {
      return { available: true, match: this.incityMatch(selectedIncity) };
    }

    return {
      available: false,
      code: 'NO_PACKAGE_AVAILABLE',
      message: 'No package configured',
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
