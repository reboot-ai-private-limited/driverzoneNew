import { describe, expect, it, vi } from 'vitest';
import { validateIncityPackageActivation } from '../src/modules/packages/domain/incityPackage.entity.js';
import {
  fareFor,
  validateOutstationBand,
  validateOutstationDriverAmounts,
  validateOutstationVariantAmounts,
} from '../src/modules/packages/domain/outstationPackage.entity.js';
import { CreateIncityPackageUseCase } from '../src/modules/packages/application/useCases/createIncityPackage.usecase.js';
import { CreateOutstationPackageUseCase } from '../src/modules/packages/application/useCases/createOutstationPackage.usecase.js';
import { ResolveForTripUseCase } from '../src/modules/packages/application/useCases/resolveForTrip.usecase.js';
import type { IncityPackage } from '../src/modules/packages/domain/incityPackage.entity.js';
import type { OutstationPackage } from '../src/modules/packages/domain/outstationPackage.entity.js';
import {
  DriverAmountError,
  InvalidPackageError,
  InvalidBandError,
  OverlappingBandError,
} from '../src/modules/packages/domain/package.errors.js';
import type { PackageRepositoryPort } from '../src/modules/packages/domain/packageRepository.port.js';

describe('Packages Module', () => {
  describe('Domain Invariants', () => {
    describe('Incity', () => {

      /**
       * P-3 narrowed when pricing by car category was retired. It used to also require an active
       * PRICE inside the active variant, because a variant could hold zero priced categories and
       * still look healthy. A variant now carries its fare structurally, so one active variant is
       * the whole of the invariant.
       */
      it('rejects an active incity package with no active variants (P-3)', () => {
        const error = validateIncityPackageActivation({
          variants: [{ isActive: false }],
        });
        expect(error).toBe('An active incity package must have at least one active variant');
      });

      it('rejects an active incity package with no variants at all (P-3)', () => {
        expect(validateIncityPackageActivation({ variants: [] })).toBe(
          'An active incity package must have at least one active variant',
        );
      });

      it('accepts a valid active incity package (P-3)', () => {
        // Defaults to true when omitted
        const error = validateIncityPackageActivation({ variants: [{}] });
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


      /**
       * P-3 is RETIRED for outstation, so there is no activation check to test. `oneWayFarePaise`
       * is a required field on the band, which makes "active but unsellable" unrepresentable
       * rather than merely forbidden. What IS still worth pinning is the direction check that
       * replaced it.
       */
      it('reports no fare for a direction the band does not sell', () => {
        const band = {
          oneWayFarePaise: 180000,
          roundTripFarePaise: null,
        } as OutstationPackage;

        expect(fareFor(band, 'ONE_WAY')).toBe(180000);
        expect(fareFor(band, 'ROUND_TRIP')).toBeNull();
      });

      it('never reads a missing return fare as free', () => {
        const band = { oneWayFarePaise: 180000, roundTripFarePaise: null } as OutstationPackage;

        // The distinction the nullable field exists for: `null` is "not offered", `0` would be
        // "the return trip costs nothing".
        expect(fareFor(band, 'ROUND_TRIP')).not.toBe(0);
      });

      it('validates one-way and round-trip driver amounts independently', () => {
        // Valid case
        expect(
          validateOutstationDriverAmounts({
            oneWayFarePaise: 500000,
            roundTripFarePaise: 800000,
            oneWayDriverAmountPaise: 400000,
            roundTripDriverAmountPaise: 700000,
          }),
        ).toBeNull();

        // One-way driver amount exceeds one-way fare
        expect(
          validateOutstationDriverAmounts({
            oneWayFarePaise: 500000,
            roundTripFarePaise: 800000,
            oneWayDriverAmountPaise: 550000,
            roundTripDriverAmountPaise: 700000,
          }),
        ).toContain('one-way driver amount');

        // Round-trip sells, but round-trip driver amount is missing
        expect(
          validateOutstationDriverAmounts({
            oneWayFarePaise: 500000,
            roundTripFarePaise: 800000,
            oneWayDriverAmountPaise: 400000,
            roundTripDriverAmountPaise: null,
          }),
        ).toContain('set what the driver is paid for it');

        // Round-trip driver amount exceeds round-trip fare
        expect(
          validateOutstationDriverAmounts({
            oneWayFarePaise: 500000,
            roundTripFarePaise: 800000,
            oneWayDriverAmountPaise: 400000,
            roundTripDriverAmountPaise: 850000,
          }),
        ).toContain('round-trip driver amount');
      });

      it('validates that outstation variant driver payout does not exceed base fare', () => {
        expect(
          validateOutstationVariantAmounts({
            variants: [
              { label: '8h', baseFarePaise: 300000, driverAmountPaise: 250000 },
              { label: '12h', baseFarePaise: 450000, driverAmountPaise: 350000 },
            ],
          }),
        ).toBeNull();

        expect(
          validateOutstationVariantAmounts({
            variants: [
              { label: '8h', baseFarePaise: 300000, driverAmountPaise: 350000 },
            ],
          }),
        ).toContain('cannot exceed the fare');
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
            variants: [],
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
          variants: [{ label: '1hr', includedMinutes: 60, baseFarePaise: 1000, driverAmountPaise: 750 }],
        };

        const result = await useCase.execute(data);
        expect(result.id).toBe('incity_123');
        expect(mockRepo.createIncity).toHaveBeenCalledWith(data);
      });

      it('refuses a variant whose driver amount exceeds its fare', async () => {
        const mockRepo = { createIncity: vi.fn() } as unknown as PackageRepositoryPort;
        const useCase = new CreateIncityPackageUseCase(mockRepo);

        await expect(
          useCase.execute({
            cityZoneId: 'city_1',
            name: 'Test Package',
            variants: [
              { label: '1hr', includedMinutes: 60, baseFarePaise: 1000, driverAmountPaise: 1200 },
            ],
          } as any),
        ).rejects.toThrow(DriverAmountError);

        expect(mockRepo.createIncity).not.toHaveBeenCalled();
      });

      it('checks the amount even on an inactive draft — it is a landmine for whoever activates it', async () => {
        const mockRepo = { createIncity: vi.fn() } as unknown as PackageRepositoryPort;
        const useCase = new CreateIncityPackageUseCase(mockRepo);

        await expect(
          useCase.execute({
            cityZoneId: 'city_1',
            name: 'Test Package',
            isActive: false,
            variants: [
              { label: '1hr', includedMinutes: 60, baseFarePaise: 1000, driverAmountPaise: 1200 },
            ],
          } as any),
        ).rejects.toThrow(DriverAmountError);
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
            oneWayFarePaise: 1000,
            driverAmountPaise: 750,
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
            oneWayFarePaise: 1000,
            oneWayDriverAmountPaise: 750,
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
          oneWayFarePaise: 1000,
          oneWayDriverAmountPaise: 750,
        };

        const result = await useCase.execute(data);
        expect(result.id).toBe('outstation_123');
        expect(mockRepo.findOverlappingBands).toHaveBeenCalled();
        expect(mockRepo.createOutstation).toHaveBeenCalledWith(data);
      });

      it('refuses a driver amount above the fare for one-way or round-trip', async () => {
        const mockRepo = {
          createOutstation: vi.fn(),
          findOverlappingBands: vi.fn().mockResolvedValue(null),
        } as unknown as PackageRepositoryPort;
        const useCase = new CreateOutstationPackageUseCase(mockRepo);

        await expect(
          useCase.execute({
            name: 'Weekend Getaway',
            terrain: 'PLAIN',
            minKm: 100,
            maxKm: 200,
            oneWayFarePaise: 5000,
            roundTripFarePaise: 8000,
            oneWayDriverAmountPaise: 5500, // exceeds 5000
            roundTripDriverAmountPaise: 7000,
          } as any),
        ).rejects.toThrow(DriverAmountError);

        await expect(
          useCase.execute({
            name: 'Weekend Getaway',
            terrain: 'PLAIN',
            minKm: 100,
            maxKm: 200,
            oneWayFarePaise: 5000,
            roundTripFarePaise: 8000,
            oneWayDriverAmountPaise: 4000,
            roundTripDriverAmountPaise: 8500, // exceeds 8000
          } as any),
        ).rejects.toThrow(DriverAmountError);

        expect(mockRepo.createOutstation).not.toHaveBeenCalled();
      });

      it('refuses an outstation variant whose driver amount exceeds its base fare', async () => {
        const mockRepo = {
          createOutstation: vi.fn(),
          findOverlappingBands: vi.fn().mockResolvedValue(null),
        } as unknown as PackageRepositoryPort;
        const useCase = new CreateOutstationPackageUseCase(mockRepo);

        await expect(
          useCase.execute({
            name: 'Weekend Getaway',
            terrain: 'PLAIN',
            minKm: 100,
            maxKm: 200,
            oneWayFarePaise: 5000,
            oneWayDriverAmountPaise: 4000,
            variants: [
              {
                label: '8 Hours',
                includedMinutes: 480,
                baseFarePaise: 3000,
                driverAmountPaise: 3500, // exceeds 3000
              },
            ],
          } as any),
        ).rejects.toThrow(DriverAmountError);

        expect(mockRepo.createOutstation).not.toHaveBeenCalled();
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

    function variant(includedMinutes: number, baseFarePaise: number, isActive = true) {
      return {
        id: `v_${includedMinutes}`,
        label: `${includedMinutes}min`,
        includedMinutes,
        baseFarePaise,
        driverAmountPaise: Math.floor(baseFarePaise * 0.75),
        isActive,
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
        oneWayFarePaise: 500000,
        roundTripFarePaise: null,
        oneWayDriverAmountPaise: 375000,
        roundTripDriverAmountPaise: null,
        variants: [],
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
    };

    it('prefers INCITY over OUTSTATION when both match — rung (a)', async () => {
      const useCase = new ResolveForTripUseCase(
        fakeRepo({
          incity: [incity({ id: 'i1', variants: [variant(180, 90000)] })],
          outstation: [outstation({ id: 'o1' })],
        }),
      );

      const result = await useCase.execute({ ...inCityTrip, distanceKm: 20 });

      expect(result.available).toBe(true);
      expect(result.available === true && result.match.type).toBe('INCITY');
    });

    /**
     * The INVERSE of the test that used to live here.
     *
     * There was a guard on rung (a): incity won only within `incity.max_distance_multiple` × the
     * longest variant's `includedKm`, so a 61 km drop inside the city polygon fell through to
     * OUTSTATION. `includedKm` was removed 2026-08-28 and the guard went with it rather than
     * being re-expressed as a flat km limit.
     *
     * This asserts the accepted consequence rather than deleting the coverage: a long trip that
     * stays inside the city zone now sells as an hourly rental, and with no overage there is
     * nothing to collect the difference. If someone re-adds a guard, this test tells them what
     * they are changing.
     */
    it('keeps a LONG in-city trip on the incity package — the rung (a) guard is gone', async () => {
      const useCase = new ResolveForTripUseCase(
        fakeRepo({
          incity: [incity({ id: 'i1', variants: [variant(180, 90000)] })],
          outstation: [outstation({ id: 'o1' })],
        }),
      );

      for (const distanceKm of [20, 61, 200]) {
        const result = await useCase.execute({ ...inCityTrip, distanceKm });
        expect(result.available === true && result.match.type).toBe('INCITY');
      }
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
        distanceKm: 120,
      });
      expect(hill.available === true && hill.match.package.name).toBe('hill');

      const plain = await useCase.execute({
        toSameCityZone: false,
        toHillZone: false,
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
                variant(180, 90000),
                variant(600, 150000),
                // Switched off. Price no longer varies by car category, so an inactive variant
                // is the only way one can be unsellable — and it must not be offered.
                variant(240, 200000, false),
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
        distanceKm: 400,
      });

      expect(result).toEqual({
        available: false,
        code: 'NO_PACKAGE_FOR_DISTANCE',
        message: expect.any(String),
      });
    });

    /**
     * NOT `NO_PACKAGE_FOR_DISTANCE`. The distance IS covered — the band matched it — so telling
     * ops to add a band would send them to create one that already exists. The gap is the
     * direction, not the distance.
     */
    it('is NO_PACKAGE_AVAILABLE when the band does not sell the requested direction', async () => {
      const useCase = new ResolveForTripUseCase(
        fakeRepo({ outstation: [outstation({ id: 'o1', roundTripFarePaise: null })] }),
      );

      const result = await useCase.execute({
        toSameCityZone: false,
        toHillZone: false,
        distanceKm: 120,
        direction: 'ROUND_TRIP',
      });

      expect(result.available).toBe(false);
      expect(result.available === false && result.code).toBe('NO_PACKAGE_AVAILABLE');
    });

    it('still sells the one-way direction on a band with no return fare', async () => {
      const useCase = new ResolveForTripUseCase(
        fakeRepo({ outstation: [outstation({ id: 'o1', roundTripFarePaise: null })] }),
      );

      const result = await useCase.execute({
        toSameCityZone: false,
        toHillZone: false,
        distanceKm: 120,
      });

      expect(result.available === true && result.match.type === 'OUTSTATION' && result.match.farePaise)
        .toBe(500000);
    });

    it('picks ONE_WAY unless a direction is given, and the two fares are independent', async () => {
      const pkg = outstation({ id: 'o1', roundTripFarePaise: 900000 });
      const useCase = new ResolveForTripUseCase(fakeRepo({ outstation: [pkg] }));

      const base = { toSameCityZone: false, toHillZone: false, distanceKm: 120 };

      const oneWay = await useCase.execute(base);
      expect(oneWay.available === true && oneWay.match.type === 'OUTSTATION' && oneWay.match.farePaise)
        .toBe(500000);

      const roundTrip = await useCase.execute({ ...base, direction: 'ROUND_TRIP' });
      expect(
        roundTrip.available === true &&
          roundTrip.match.type === 'OUTSTATION' &&
          roundTrip.match.farePaise,
      ).toBe(900000);
      // Not 2× the one-way, and never derived from it.
      expect(900000).not.toBe(500000 * 2);
    });

    it('breaks a tie on the more recently created package — rung (d), never a coin flip', async () => {
      const older = outstation({ id: 'older', createdAt: new Date('2026-01-01') });
      const newer = outstation({ id: 'newer', createdAt: new Date('2026-06-01') });
      const useCase = new ResolveForTripUseCase(fakeRepo({ outstation: [older, newer] }));

      const result = await useCase.execute({
        toSameCityZone: false,
        toHillZone: false,
        distanceKm: 120,
      });

      expect(result.available === true && result.match.package.name).toBe('newer');
    });

    it('offers no incity package when the pickup point is outside the city zone', async () => {
      const useCase = new ResolveForTripUseCase(
        fakeRepo({
          incity: [incity({ id: 'i1', variants: [variant(180, 90000)] })],
          outstation: [outstation({ id: 'o1' })],
        }),
      );

      const result = await useCase.execute({
        // Drop is in the city, pickup is not — incity requires both.
        toSameCityZone: true,
        toHillZone: false,
        distanceKm: 20,
      });

      expect(result.available === true && result.match.type).toBe('OUTSTATION');
    });
  });
});
