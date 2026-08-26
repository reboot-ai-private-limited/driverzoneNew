import { describe, expect, it, vi } from 'vitest';
import { validateIncityPackageActivation } from '../src/modules/packages/domain/incityPackage.entity.js';
import { validateOutstationBand, validateOutstationPackageActivation } from '../src/modules/packages/domain/outstationPackage.entity.js';
import { CreateIncityPackageUseCase } from '../src/modules/packages/application/useCases/createIncityPackage.usecase.js';
import { CreateOutstationPackageUseCase } from '../src/modules/packages/application/useCases/createOutstationPackage.usecase.js';
import { ResolveForTripUseCase } from '../src/modules/packages/application/useCases/resolveForTrip.usecase.js';
import type { IncityPackage } from '../src/modules/packages/domain/incityPackage.entity.js';
import type { OutstationPackage } from '../src/modules/packages/domain/outstationPackage.entity.js';
import { InvalidPackageError, InvalidBandError, OverlappingBandError } from '../src/modules/packages/domain/package.errors.js';
import type { PackageRepositoryPort } from '../src/modules/packages/domain/packageRepository.port.js';

describe('Packages Module', () => {
  describe('Domain Invariants', () => {
    describe('Incity', () => {

      it('rejects an active incity package with no active variants or prices (P-3)', () => {
        const error = validateIncityPackageActivation({
          variants: [{ isActive: false, prices: [{ isActive: true }] }],
        });
        expect(error).toBe('An active incity package must have at least one active variant with an active price');

        const error2 = validateIncityPackageActivation({
          variants: [{ isActive: true, prices: [{ isActive: false }] }],
        });
        expect(error2).toBe('An active incity package must have at least one active variant with an active price');
      });

      it('accepts a valid active incity package (P-3)', () => {
        // Defaults to true when omitted
        const error = validateIncityPackageActivation({
          variants: [{ prices: [{}] }],
        });
        expect(error).toBeNull();
      });
    });

    describe('Outstation', () => {
      it('rejects an outstation band where minKm < 0 (P-4)', () => {
        const error = validateOutstationBand(-10, 100);
        expect(error).toBe('minKm must be >= 0');
      });

      it('rejects an outstation band where minKm >= maxKm (P-4)', () => {
        const error = validateOutstationBand(200, 100);
        expect(error).toBe('maxKm must be greater than minKm');

        const errorEq = validateOutstationBand(100, 100);
        expect(errorEq).toBe('maxKm must be greater than minKm');
      });

      it('accepts a valid outstation band (P-4)', () => {
        const error = validateOutstationBand(100, 200);
        expect(error).toBeNull();
      });


      it('rejects an active outstation package with no active prices (P-3)', () => {
        const error = validateOutstationPackageActivation({
          prices: [{ isActive: false }],
        });
        expect(error).toBe('An active outstation package must have at least one active price');
      });

      it('accepts a valid active outstation package (P-3)', () => {
        const error = validateOutstationPackageActivation({
          prices: [{}],
        });
        expect(error).toBeNull();
      });
    });
  });

  describe('Use Cases', () => {
    describe('CreateIncityPackageUseCase', () => {
      it('throws InvalidPackageError if activation rules fail', async () => {
        const mockRepo = { createIncity: vi.fn() } as unknown as PackageRepositoryPort;
        const useCase = new CreateIncityPackageUseCase(mockRepo);

        await expect(
          useCase.execute({
            cityZoneId: 'city_1',
            name: 'Test Package',
            variants: [{ label: '1hr', includedKm: 10, includedMinutes: 60, prices: [] }],
          })
        ).rejects.toThrow(InvalidPackageError);

        expect(mockRepo.createIncity).not.toHaveBeenCalled();
      });

      it('creates package when rules pass', async () => {
        const mockRepo = {
          createIncity: vi.fn().mockResolvedValue({ id: 'incity_123' }),
        } as unknown as PackageRepositoryPort;
        const useCase = new CreateIncityPackageUseCase(mockRepo);

        const data: any = {
          cityZoneId: 'city_1',
          name: 'Test Package',
          variants: [{ label: '1hr', includedKm: 10, includedMinutes: 60, prices: [{ carCategoryId: 'car_1', baseFarePaise: 1000, companyCommissionValue: 10, driverCommissionValue: 10, driverCommissionType: 'PERCENT', companyCommissionType: 'PERCENT' }] }],
        };

        const result = await useCase.execute(data);
        expect(result.id).toBe('incity_123');
        expect(mockRepo.createIncity).toHaveBeenCalledWith(data);
      });
    });

    describe('CreateOutstationPackageUseCase', () => {
      it('throws InvalidBandError if distance band is invalid', async () => {
        const mockRepo = {
          createOutstation: vi.fn(),
          findOverlappingBands: vi.fn(),
        } as unknown as PackageRepositoryPort;
        const useCase = new CreateOutstationPackageUseCase(mockRepo);

        await expect(
          useCase.execute({
            name: 'Weekend Getaway',
            terrain: 'PLAIN',
              minKm: 200,
            maxKm: 100, // Invalid
            prices: [{ carCategoryId: 'car_1', direction: 'ONE_WAY', baseFarePaise: 1000, companyCommissionValue: 10, driverCommissionValue: 10, driverCommissionType: 'PERCENT', companyCommissionType: 'PERCENT' }],
          })
        ).rejects.toThrow(InvalidBandError);

        expect(mockRepo.findOverlappingBands).not.toHaveBeenCalled();
        expect(mockRepo.createOutstation).not.toHaveBeenCalled();
      });

      it('throws OverlappingBandError if band conflicts with existing package (P-2)', async () => {
        const mockRepo = {
          createOutstation: vi.fn(),
          findOverlappingBands: vi.fn().mockResolvedValue({ id: 'existing_pkg_id' }), // Simulates a conflict
        } as unknown as PackageRepositoryPort;
        const useCase = new CreateOutstationPackageUseCase(mockRepo);

        await expect(
          useCase.execute({
            name: 'Weekend Getaway',
            terrain: 'PLAIN',
              minKm: 100,
            maxKm: 200,
            prices: [{ carCategoryId: 'car_1', direction: 'ONE_WAY', baseFarePaise: 1000, companyCommissionValue: 10, driverCommissionValue: 10, driverCommissionType: 'PERCENT', companyCommissionType: 'PERCENT' }],
          })
        ).rejects.toThrow(OverlappingBandError);

        expect(mockRepo.findOverlappingBands).toHaveBeenCalledWith({
          terrain: 'PLAIN',
          minKm: 100,
          maxKm: 200,
        });
        expect(mockRepo.createOutstation).not.toHaveBeenCalled();
      });

      it('creates package when rules pass and no overlap exists', async () => {
        const mockRepo = {
          createOutstation: vi.fn().mockResolvedValue({ id: 'outstation_123' }),
          findOverlappingBands: vi.fn().mockResolvedValue(null), // No conflict
        } as unknown as PackageRepositoryPort;
        const useCase = new CreateOutstationPackageUseCase(mockRepo);

        const data: any = {
          name: 'Weekend Getaway',
          terrain: 'PLAIN',
          minKm: 100,
          maxKm: 200,
          prices: [{ carCategoryId: 'car_1', direction: 'ONE_WAY', baseFarePaise: 1000, companyCommissionValue: 10, driverCommissionValue: 10, driverCommissionType: 'PERCENT', companyCommissionType: 'PERCENT' }],
        };

        const result = await useCase.execute(data);
        expect(result.id).toBe('outstation_123');
        expect(mockRepo.findOverlappingBands).toHaveBeenCalled();
        expect(mockRepo.createOutstation).toHaveBeenCalledWith(data);
      });
    });
  });

  /**
   * The resolution path — docs/LLD/packages.md §Resolution. The customer supplies two points and
   * a car category and never picks a tab, so everything here is about the server choosing, and
   * choosing exactly one.
   *
   * Zone facts arrive as scalars on `TripContext`, which is what lets this be driven with a
   * hand-written fake repository and no zones module at all.
   */
  describe('ResolveForTripUseCase', () => {
    const CAR = 'car_1';
    const CITY = 'city_1';

    function incity(overrides: Partial<IncityPackage> & { id: string }): IncityPackage {
      return {
        cityZoneId: CITY,
        name: overrides.id,
        variants: [],
        isActive: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        ...overrides,
      };
    }

    function variant(includedKm: number, baseFarePaise: number, carCategoryId = CAR) {
      return {
        id: `v_${includedKm}`,
        label: `${includedKm}km`,
        includedMinutes: 180,
        includedKm,
        enforceDropInCity: true,
        sortOrder: 0,
        isActive: true,
        prices: [
          {
            id: `p_${includedKm}`,
            carCategoryId,
            baseFarePaise,
            extraMinuteRatePaise: 0,
            extraKmRatePaise: 0,
            nightChargePaise: 0,
            driverCommissionType: 'PERCENT' as const,
            driverCommissionValue: 7500,
            companyCommissionType: 'PERCENT' as const,
            companyCommissionValue: 2500,
            isActive: true,
          },
        ],
      };
    }

    function outstation(
      overrides: Partial<OutstationPackage> & { id: string },
    ): OutstationPackage {
      return {
        name: overrides.id,
        terrain: 'PLAIN',
        minKm: 0,
        maxKm: 500,
        isActive: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        prices: [
          {
            id: `op_${overrides.id}`,
            carCategoryId: CAR,
            direction: 'ONE_WAY',
            baseFarePaise: 500000,
            extraKmRatePaise: 0,
            driverAllowancePaise: 0,
            driverCommissionType: 'PERCENT',
            driverCommissionValue: 7500,
            companyCommissionType: 'PERCENT',
            companyCommissionValue: 2500,
            isActive: true,
          },
        ],
        ...overrides,
      };
    }

    /** A real in-memory port, not a `vi.mock` — see docs/engineering/testing.md. */
    function fakeRepo(seed: { incity?: IncityPackage[]; outstation?: OutstationPackage[] } = {}) {
      return {
        findIncityForQuote: async ({ cityZoneId }: { cityZoneId: string }) =>
          (seed.incity ?? []).filter((p) => p.isActive && p.cityZoneId === cityZoneId),
        findOutstationForQuote: async ({
          terrain,
          distanceKm,
        }: {
          terrain: 'PLAIN' | 'HILL';
          distanceKm: number;
        }) =>
          (seed.outstation ?? []).filter(
            (p) =>
              p.isActive &&
              p.terrain === terrain &&
              p.minKm <= distanceKm &&
              // Half-open: 70 km belongs to 70-100, never to 0-70.
              p.maxKm > distanceKm,
          ),
      } as unknown as PackageRepositoryPort;
    }

    const inCityTrip = {
      fromCityZoneId: CITY,
      toSameCityZone: true,
      toHillZone: false,
      carCategoryId: CAR,
    };

    it('prefers INCITY over OUTSTATION when both match — rung (a)', async () => {
      const useCase = new ResolveForTripUseCase(
        fakeRepo({
          incity: [incity({ id: 'i1', variants: [variant(30, 90000)] })],
          outstation: [outstation({ id: 'o1' })],
        }),
      );

      const result = await useCase.execute({ ...inCityTrip, distanceKm: 20 });

      expect(result.available).toBe(true);
      expect(result.available === true && result.match.type).toBe('INCITY');
    });

    it('falls through to OUTSTATION past incity.max_distance_multiple — the rung (a) guard', async () => {
      // Longest variant includes 30 km, multiple is 2, so incity covers up to 60 km. A 61 km
      // drop inside the city polygon is plainly an outstation run and must price as one.
      const useCase = new ResolveForTripUseCase(
        fakeRepo({
          incity: [incity({ id: 'i1', variants: [variant(30, 90000)] })],
          outstation: [outstation({ id: 'o1' })],
        }),
      );

      expect((await useCase.execute({ ...inCityTrip, distanceKm: 60 })).available).toBe(true);
      const atBoundary = await useCase.execute({ ...inCityTrip, distanceKm: 60 });
      expect(atBoundary.available === true && atBoundary.match.type).toBe('INCITY');

      const past = await useCase.execute({ ...inCityTrip, distanceKm: 61 });
      expect(past.available === true && past.match.type).toBe('OUTSTATION');
    });

    it('selects the HILL band when the drop point is in a hill zone, never the PLAIN one', async () => {
      const useCase = new ResolveForTripUseCase(
        fakeRepo({
          outstation: [
            outstation({ id: 'plain', terrain: 'PLAIN' }),
            outstation({ id: 'hill', terrain: 'HILL' }),
          ],
        }),
      );

      const hill = await useCase.execute({
        toSameCityZone: false,
        toHillZone: true,
        carCategoryId: CAR,
        distanceKm: 120,
      });
      expect(hill.available === true && hill.match.package.name).toBe('hill');

      const plain = await useCase.execute({
        toSameCityZone: false,
        toHillZone: false,
        carCategoryId: CAR,
        distanceKm: 120,
      });
      expect(plain.available === true && plain.match.package.name).toBe('plain');
    });

    it('returns exactly one match, and every sellable variant on it', async () => {
      const useCase = new ResolveForTripUseCase(
        fakeRepo({
          incity: [
            incity({
              id: 'i1',
              variants: [
                variant(30, 90000),
                variant(60, 150000),
                // No price for this car category — not sellable, must not be offered.
                variant(90, 200000, 'car_other'),
              ],
            }),
          ],
        }),
      );

      const result = await useCase.execute({ ...inCityTrip, distanceKm: 20 });

      expect(result.available === true && result.match.type === 'INCITY' && result.match.variants)
        .toHaveLength(2);
    });

    it('is NO_PACKAGE_FOR_DISTANCE when no band covers the distance — a 200, not an error', async () => {
      const useCase = new ResolveForTripUseCase(
        fakeRepo({ outstation: [outstation({ id: 'o1', minKm: 0, maxKm: 70 })] }),
      );

      const result = await useCase.execute({
        toSameCityZone: false,
        toHillZone: false,
        carCategoryId: CAR,
        distanceKm: 400,
      });

      expect(result).toEqual({
        available: false,
        code: 'NO_PACKAGE_FOR_DISTANCE',
        message: expect.any(String),
      });
    });

    it('is NO_PACKAGE_AVAILABLE when the band exists but has no price for the car category', async () => {
      const useCase = new ResolveForTripUseCase(
        fakeRepo({
          outstation: [
            outstation({
              id: 'o1',
              prices: [
                {
                  id: 'p1',
                  carCategoryId: 'car_other',
                  direction: 'ONE_WAY',
                  baseFarePaise: 500000,
                  extraKmRatePaise: 0,
                  driverAllowancePaise: 0,
                  driverCommissionType: 'PERCENT',
                  driverCommissionValue: 7500,
                  companyCommissionType: 'PERCENT',
                  companyCommissionValue: 2500,
                  isActive: true,
                },
              ],
            }),
          ],
        }),
      );

      const result = await useCase.execute({
        toSameCityZone: false,
        toHillZone: false,
        carCategoryId: CAR,
        distanceKm: 120,
      });

      expect(result.available).toBe(false);
      expect(result.available === false && result.code).toBe('NO_PACKAGE_AVAILABLE');
    });

    it('picks ONE_WAY unless a direction is given, and the two are independent rows', async () => {
      const pkg = outstation({ id: 'o1' });
      pkg.prices.push({ ...pkg.prices[0]!, id: 'p_rt', direction: 'ROUND_TRIP', baseFarePaise: 900000 });
      const useCase = new ResolveForTripUseCase(fakeRepo({ outstation: [pkg] }));

      const base = { toSameCityZone: false, toHillZone: false, carCategoryId: CAR, distanceKm: 120 };

      const oneWay = await useCase.execute(base);
      expect(oneWay.available === true && oneWay.match.type === 'OUTSTATION' && oneWay.match.price.baseFarePaise)
        .toBe(500000);

      const roundTrip = await useCase.execute({ ...base, direction: 'ROUND_TRIP' });
      expect(
        roundTrip.available === true &&
          roundTrip.match.type === 'OUTSTATION' &&
          roundTrip.match.price.baseFarePaise,
      ).toBe(900000);
    });

    it('breaks a tie on the more recently created package — rung (d), never a coin flip', async () => {
      const older = outstation({ id: 'older', createdAt: new Date('2026-01-01') });
      const newer = outstation({ id: 'newer', createdAt: new Date('2026-06-01') });
      const useCase = new ResolveForTripUseCase(fakeRepo({ outstation: [older, newer] }));

      const result = await useCase.execute({
        toSameCityZone: false,
        toHillZone: false,
        carCategoryId: CAR,
        distanceKm: 120,
      });

      expect(result.available === true && result.match.package.name).toBe('newer');
    });

    it('offers no incity package when the pickup point is outside the city zone', async () => {
      const useCase = new ResolveForTripUseCase(
        fakeRepo({
          incity: [incity({ id: 'i1', variants: [variant(30, 90000)] })],
          outstation: [outstation({ id: 'o1' })],
        }),
      );

      const result = await useCase.execute({
        // Drop is in the city, pickup is not — incity requires both.
        toSameCityZone: true,
        toHillZone: false,
        carCategoryId: CAR,
        distanceKm: 20,
      });

      expect(result.available === true && result.match.type).toBe('OUTSTATION');
    });
  });
});
