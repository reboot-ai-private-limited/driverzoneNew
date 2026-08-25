import type { TripContext, PackageMatch, Unavailable } from '../../packages.public.js';
import type { PackageRepositoryPort } from '../../domain/packageRepository.port.js';
import type { IncityPackage } from '../../domain/incityPackage.entity.js';
import type { OutstationPackage } from '../../domain/outstationPackage.entity.js';

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

    const validIncity = incityCandidates.filter((pkg) =>
      pkg.variants.some(
        (v) => v.isActive && v.prices.some((p) => p.isActive && p.carCategoryId === input.carCategoryId),
      ),
    );

    const direction = input.direction ?? 'ONE_WAY';
    const validOutstation = outstationCandidates.filter((pkg) =>
      pkg.prices.some(
        (p) => p.isActive && p.carCategoryId === input.carCategoryId && p.direction === direction,
      ),
    );

    if (validIncity.length === 0 && validOutstation.length === 0) {
      if (outstationCandidates.length === 0 && (!input.toSameCityZone || incityCandidates.length === 0)) {
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
    const selectedIncity = this.getBestIncity(validIncity, input.carCategoryId);

    if (selectedIncity) {
      const maxIncludedKm = Math.max(...selectedIncity.variants.map((v) => v.includedKm));
      const MAX_DISTANCE_MULTIPLE = 1.5; // TODO: fetch from globalSettings
      if (input.distanceKm <= maxIncludedKm * MAX_DISTANCE_MULTIPLE) {
        return {
          available: true,
          match: {
            type: 'INCITY',
            package: selectedIncity,
            variants: selectedIncity.variants.filter(
              (v) => v.isActive && v.prices.some((p) => p.isActive && p.carCategoryId === input.carCategoryId),
            ),
          },
        };
      }
    }

    // b. HILL beats PLAIN (handled by terrain logic)
    // c & d. lower total / recently created
    const selectedOutstation = this.getBestOutstation(validOutstation, input.carCategoryId, direction);
    if (selectedOutstation) {
      return {
        available: true,
        match: {
          type: 'OUTSTATION',
          package: selectedOutstation,
          price: selectedOutstation.prices.find(
            (p) => p.isActive && p.carCategoryId === input.carCategoryId && p.direction === direction,
          )!,
        },
      };
    }

    if (selectedIncity) {
      return {
        available: true,
        match: {
          type: 'INCITY',
          package: selectedIncity,
          variants: selectedIncity.variants.filter(
            (v) => v.isActive && v.prices.some((p) => p.isActive && p.carCategoryId === input.carCategoryId),
          ),
        },
      };
    }

    return {
      available: false,
      code: 'NO_PACKAGE_AVAILABLE',
      message: 'No package configured',
    };
  }

  private getBestIncity(packages: IncityPackage[], carCategoryId: string): IncityPackage | null {
    if (packages.length === 0) return null;
    return packages.sort((a, b) => {
      const aCheapest = Math.min(
        ...a.variants.map(
          (v) => v.prices.find((p) => p.carCategoryId === carCategoryId)?.baseFarePaise ?? Infinity,
        ),
      );
      const bCheapest = Math.min(
        ...b.variants.map(
          (v) => v.prices.find((p) => p.carCategoryId === carCategoryId)?.baseFarePaise ?? Infinity,
        ),
      );
      if (aCheapest !== bCheapest) return aCheapest - bCheapest;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })[0] ?? null;
  }

  private getBestOutstation(
    packages: OutstationPackage[],
    carCategoryId: string,
    direction: 'ONE_WAY' | 'ROUND_TRIP',
  ): OutstationPackage | null {
    if (packages.length === 0) return null;
    return packages.sort((a, b) => {
      const aPrice =
        a.prices.find((p) => p.carCategoryId === carCategoryId && p.direction === direction)
          ?.baseFarePaise ?? Infinity;
      const bPrice =
        b.prices.find((p) => p.carCategoryId === carCategoryId && p.direction === direction)
          ?.baseFarePaise ?? Infinity;
      if (aPrice !== bPrice) return aPrice - bPrice;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })[0] ?? null;
  }
}
