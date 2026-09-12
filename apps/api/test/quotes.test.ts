import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LatLng } from '@driverzone/geo';
import { CreateQuoteUseCase } from '../src/modules/quotes/application/useCases/createQuote.usecase.js';
import type { Quote } from '../src/modules/quotes/domain/quote.entity.js';
import type {
  NewQuote,
  QuoteRepositoryPort,
} from '../src/modules/quotes/domain/quoteRepository.port.js';
import type { RoadDistancePort } from '../src/modules/quotes/domain/roadDistance.port.js';
import type { PackageLookupContract } from '../src/modules/packages/packages.public.js';
import type { ZoneResolutionContract } from '../src/modules/zones/zones.public.js';
import type { SettingsReadContract } from '../src/modules/settings/settings.public.js';
import type { Zone } from '../src/modules/zones/domain/zone.entity.js';
import { buildSnapshot } from '../src/modules/settings/domain/setting.entity.js';

const SILIGURI: LatLng = { lat: 26.7271, lng: 88.3953 };
const DARJEELING: LatLng = { lat: 27.041, lng: 88.2663 };

function zone(over: Partial<Zone> & Pick<Zone, 'id' | 'type' | 'name'>): Zone {
  return {
    code: over.name.toUpperCase().replace(/\s/g, '_'),
    parentZoneId: null,
    geometry: { type: 'Polygon', coordinates: [] },
    priority: 0,
    pickupChargeType: null,
    pickupChargePaise: null,
    version: 1,
    supersededBy: null,
    isActive: true,
    createdBy: 'adm_1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

const cityZone = zone({ id: 'zon_city', type: 'CITY', name: 'Siliguri' });
const freePickup = zone({
  id: 'zon_pickup_free',
  type: 'PICKUP',
  name: 'Siliguri Central',
  pickupChargeType: 'FREE',
});
const paidPickup = zone({
  id: 'zon_pickup_paid',
  type: 'PICKUP',
  name: 'Siliguri Outskirts',
  pickupChargeType: 'PAID',
  pickupChargePaise: null,
});
const hillZone = zone({ id: 'zon_hill', type: 'HILL', name: 'Darjeeling Hills' });

/** Every setting at its registry default — the same object the real read path builds. */
const settings: SettingsReadContract = {
  snapshot: async () => buildSnapshot([]),
  get: async (key) => buildSnapshot([])[key],
};

function fakeZones(
  from: Partial<ReturnType<typeof resolved>>,
  to: Partial<ReturnType<typeof resolved>>,
): ZoneResolutionContract {
  return {
    resolveAt: vi.fn(async (point: LatLng) =>
      point.lat === SILIGURI.lat ? resolved(from) : resolved(to),
    ),
    findHillZonesNear: vi.fn(async () => []),
  };
}

function resolved(over: { city?: Zone | null; pickup?: Zone | null; hill?: Zone | null } = {}) {
  return { city: over.city ?? null, pickup: over.pickup ?? null, hill: over.hill ?? null, all: [] };
}

function fakeRepo(): QuoteRepositoryPort & { written: NewQuote[] } {
  const written: NewQuote[] = [];
  return {
    written,
    createMany: vi.fn(async (quotes: readonly NewQuote[]) => {
      written.push(...quotes);
      return quotes.map((q, i): Quote => ({
        ...q,
        id: `qot_${i}`,
        consumedBy: null,
        createdAt: new Date(),
      }));
    }),
    findById: vi.fn(async () => null),
    consume: vi.fn(async () => null),
  };
}

const distance = (km: number, durationMinutes: number | null = 120): RoadDistancePort => ({
  roadDistanceKm: vi.fn(async () => km),
  travelDurationMinutes: vi.fn(async () => durationMinutes),
});

const incityVariants = [
  {
    id: 'var_3h',
    label: '3 Hours',
    includedMinutes: 180,
    baseFarePaise: 90_000,
    driverAmountPaise: 67_500,
    isActive: true,
  },
  {
    id: 'var_6h',
    label: '6 Hours',
    includedMinutes: 360,
    baseFarePaise: 160_000,
    driverAmountPaise: 120_000,
    isActive: true,
  },
];

function incityPackages(): PackageLookupContract {
  return {
    resolveForTrip: vi.fn(async () => ({
      available: true as const,
      match: {
        type: 'INCITY' as const,
        package: {
          id: 'pkg_1',
          cityZoneId: cityZone.id,
          name: 'Siliguri Hourly',
          variants: incityVariants,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        variants: incityVariants,
      },
    })),
  };
}

function outstationPackages(): PackageLookupContract {
  return {
    resolveForTrip: vi.fn(async () => ({
      available: true as const,
      match: {
        type: 'OUTSTATION' as const,
        package: {
          id: 'pkg_2',
          name: 'PKG-3',
          terrain: 'HILL' as const,
          minKm: 70,
          maxKm: 100,
          oneWayFarePaise: 450_000,
          roundTripFarePaise: 700_000,
          oneWayDriverAmountPaise: 315_000,
          roundTripDriverAmountPaise: 490_000,
          variants: [],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        farePaise: 450_000,
        direction: 'ONE_WAY' as const,
        variants: [],
      },
    })),
  };
}

let repo: ReturnType<typeof fakeRepo>;

/**
 * A FIXED INSTANT, because this suite asserts fare totals and a fare depends on the clock.
 *
 * `CreateQuoteUseCase` prices against `input.scheduledAt ?? now`, and no test here passes one — so
 * every subtotal below was being computed against the wall clock of whoever ran it.
 * `surchargeFor` adds ₹150 inside `pricing.late_night_window` (22:00–04:00 IST) and ₹100 inside
 * `pricing.early_morning_window` (04:00–06:00), which made "generates options for active
 * outstation variants" fail with `318000` where it expects `303000` — but only when run between
 * 10pm and 6am. Green all day, red in the evening, with nothing in the diff to explain it.
 *
 * 2026-08-31T06:00:00Z is 11:30 IST: outside both windows, which is what every expected figure in
 * this file already assumes. Pinning it changes no assertion, it just stops the answer depending
 * on when the suite happens to run.
 *
 * `shouldAdvanceTime` keeps the event loop moving — without it a faked clock stalls the timers
 * that `await` itself depends on, and the suite hangs rather than fails.
 */
const NOON_IST = new Date('2026-08-31T06:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOON_IST);
  repo = fakeRepo();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CreateQuoteUseCase — unavailable answers', () => {
  it('refuses a pickup point outside every pickup zone, as a 200-shaped result', async () => {
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone }, { city: cityZone }),
      incityPackages(),
      settings,
      distance(8),
      repo,
    );

    const result = await useCase.execute({
      customerId: 'cus_1',
      pickup: SILIGURI,
      drop: DARJEELING,
    });

    expect(result).toMatchObject({ available: false, reason: 'ZONE_NO_PICKUP_COVERAGE' });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it('reports no route rather than throwing', async () => {
    // An outstation trip: the drop is in a hill zone, not the pickup's city, so the in-city
    // fast path is skipped and the routing provider is actually consulted.
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { hill: hillZone }),
      outstationPackages(),
      settings,
      { roadDistanceKm: vi.fn(async () => null) },
      repo,
    );

    const result = await useCase.execute({
      customerId: 'cus_1',
      pickup: SILIGURI,
      drop: DARJEELING,
    });
    expect(result).toMatchObject({ available: false, reason: 'ROUTE_NOT_FOUND' });
  });

  it('passes a package module refusal straight through', async () => {
    const packages: PackageLookupContract = {
      resolveForTrip: vi.fn(async () => ({
        available: false as const,
        code: 'NO_PACKAGE_FOR_DISTANCE' as const,
        message: 'We do not serve trips this long yet.',
      })),
    };

    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, {}),
      packages,
      settings,
      distance(900),
      repo,
    );

    const result = await useCase.execute({
      customerId: 'cus_1',
      pickup: SILIGURI,
      drop: DARJEELING,
    });
    expect(result).toMatchObject({ available: false, reason: 'NO_PACKAGE_FOR_DISTANCE' });
  });
});

describe('CreateQuoteUseCase — incity', () => {
  it('never calls the routing provider for an in-city trip', async () => {
    const roadDistanceKm = vi.fn(async () => 8);
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { city: cityZone }),
      incityPackages(),
      settings,
      { roadDistanceKm },
      repo,
    );

    const result = await useCase.execute({ customerId: 'cus_1', pickup: SILIGURI, drop: SILIGURI });

    expect(result.available).toBe(true);
    expect(roadDistanceKm).not.toHaveBeenCalled();
  });

  it('writes one quote per variant so the customer can pick a duration', async () => {
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { city: cityZone }),
      incityPackages(),
      settings,
      distance(8),
      repo,
    );

    const result = await useCase.execute({ customerId: 'cus_1', pickup: SILIGURI, drop: SILIGURI });

    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.quotes).toHaveLength(2);
    expect(result.quotes.map((q) => q.includedMinutes)).toEqual([180, 360]);
    expect(result.distanceKm).toBeNull();
    expect(result.outstationHoursPerDay).toBeNull();
  });

  it('charges no pickup fee from a FREE zone', async () => {
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { city: cityZone }),
      incityPackages(),
      settings,
      distance(8),
      repo,
    );

    const result = await useCase.execute({ customerId: 'cus_1', pickup: SILIGURI, drop: SILIGURI });
    if (!result.available) throw new Error('expected a quote');

    const codes = result.quotes[0]?.fare.lines.map((l) => l.code);
    expect(codes).not.toContain('PICKUP_FEE');
  });

  it('charges insurance by default, when the request is silent about it', async () => {
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { city: cityZone }),
      incityPackages(),
      settings,
      distance(8),
      repo,
    );

    const result = await useCase.execute({ customerId: 'cus_1', pickup: SILIGURI, drop: SILIGURI });
    if (!result.available) throw new Error('expected a quote');

    const insuranceLine = result.quotes[0]?.fare.lines.find((l) => l.code === 'INSURANCE');
    expect(insuranceLine?.amountPaise).toBe(3_000); // pricing.insurance_charge is ₹30 in the registry.
  });

  it('drops the insurance line entirely when the customer opts out', async () => {
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { city: cityZone }),
      incityPackages(),
      settings,
      distance(8),
      repo,
    );

    const result = await useCase.execute({
      customerId: 'cus_1',
      pickup: SILIGURI,
      drop: SILIGURI,
      insurance: false,
    });
    if (!result.available) throw new Error('expected a quote');

    const codes = result.quotes[0]?.fare.lines.map((l) => l.code);
    expect(codes).not.toContain('INSURANCE');
  });

  it('falls back to the settings default for a PAID zone with no override', async () => {
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: paidPickup }, { city: cityZone }),
      incityPackages(),
      settings,
      distance(8),
      repo,
    );

    const result = await useCase.execute({ customerId: 'cus_1', pickup: SILIGURI, drop: SILIGURI });
    if (!result.available) throw new Error('expected a quote');

    // pickup.default_charge is ₹100 in the registry, and it must arrive as 10000 PAISE.
    const pickupLine = result.quotes[0]?.fare.lines.find((l) => l.code === 'PICKUP_FEE');
    expect(pickupLine?.amountPaise).toBe(10_000);
  });

  it('gives every option the same expiry so one countdown is honest', async () => {
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { city: cityZone }),
      incityPackages(),
      settings,
      distance(8),
      repo,
    );

    const result = await useCase.execute({ customerId: 'cus_1', pickup: SILIGURI, drop: SILIGURI });
    if (!result.available) throw new Error('expected a quote');

    const expiries = new Set(result.quotes.map((q) => q.expiresAt.getTime()));
    expect(expiries.size).toBe(1);
  });
});

describe('CreateQuoteUseCase — outstation', () => {
  it('returns one option, the matched distance and the display-only hours policy', async () => {
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { hill: hillZone }),
      outstationPackages(),
      settings,
      distance(88),
      repo,
    );

    const result = await useCase.execute({
      customerId: 'cus_1',
      pickup: SILIGURI,
      drop: DARJEELING,
      direction: 'ONE_WAY',
    });

    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.quotes).toHaveLength(1);
    expect(result.distanceKm).toBe(88);
    expect(result.outstationHoursPerDay).toBe(10);
    expect(result.quotes[0]?.source.terrain).toBe('HILL');
    expect(result.quotes[0]?.includedMinutes).toBeNull();
  });

  it('tells the packages module the destination is in a hill zone', async () => {
    const packages = outstationPackages();
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { hill: hillZone }),
      packages,
      settings,
      distance(88),
      repo,
    );

    await useCase.execute({ customerId: 'cus_1', pickup: SILIGURI, drop: DARJEELING });

    expect(packages.resolveForTrip).toHaveBeenCalledWith(
      expect.objectContaining({ toHillZone: true, toSameCityZone: false, distanceKm: 88 }),
    );
  });

  it('records the trip as same-city when both points share a city zone', async () => {
    const packages = incityPackages();
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { city: cityZone }),
      packages,
      settings,
      distance(8),
      repo,
    );

    await useCase.execute({ customerId: 'cus_1', pickup: SILIGURI, drop: SILIGURI });

    expect(packages.resolveForTrip).toHaveBeenCalledWith(
      expect.objectContaining({ toSameCityZone: true, fromCityZoneId: cityZone.id }),
    );
  });

  it('prices a one-way trip <= 8 hours as single-day with no extra return line', async () => {
    const packages = outstationPackages();
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { hill: hillZone }),
      packages,
      settings,
      distance(88, 300), // 5 hours (300 mins) <= 8 hours
      repo,
    );

    const result = await useCase.execute({
      customerId: 'cus_1',
      pickup: SILIGURI,
      drop: DARJEELING,
      direction: 'ONE_WAY',
    });

    expect(result.available).toBe(true);
    if (!result.available) return;

    const quote = result.quotes[0]!;
    expect(quote.fare.lines.find((l) => l.code === 'RETURN_DRIVER_ALLOWANCE')).toBeUndefined();
    expect(quote.fare.lines[0]?.amountPaise).toBe(450_000); // 1 day base fare
    expect(quote.direction).toBe('ONE_WAY');
    expect(quote.distanceKm).toBe(88);
  });

  it('adds 1 day return allowance to a one-way trip taking between 8 and 10 hours', async () => {
    const packages = outstationPackages();
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { hill: hillZone }),
      packages,
      settings,
      distance(88, 540), // 9 hours (540 mins) > 8h and <= 10h
      repo,
    );

    const result = await useCase.execute({
      customerId: 'cus_1',
      pickup: SILIGURI,
      drop: DARJEELING,
      direction: 'ONE_WAY',
    });

    expect(result.available).toBe(true);
    if (!result.available) return;

    const quote = result.quotes[0]!;
    const returnLine = quote.fare.lines.find((l) => l.code === 'RETURN_DRIVER_ALLOWANCE');
    expect(returnLine).toBeDefined();
    expect(returnLine?.amountPaise).toBe(315_000); // 1 day driverAmountPaise (315k on pkg_2)
    expect(quote.fare.lines[0]?.amountPaise).toBe(450_000); // 1 day base fare
  });

  it('prices a 16-hour one-way trip as 2 forward days plus 2 days return allowance', async () => {
    const packages = outstationPackages();
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { hill: hillZone }),
      packages,
      settings,
      distance(88, 960), // 16 hours (960 mins) -> forward 2, extra 2
      repo,
    );

    const result = await useCase.execute({
      customerId: 'cus_1',
      pickup: SILIGURI,
      drop: DARJEELING,
      direction: 'ONE_WAY',
    });

    expect(result.available).toBe(true);
    if (!result.available) return;

    const quote = result.quotes[0]!;
    expect(quote.fare.lines[0]?.amountPaise).toBe(900_000); // 450,000 * 2
    expect(quote.fare.lines[0]?.label).toBe('PKG-3 — One way × 2 days');
    const returnLine = quote.fare.lines.find((l) => l.code === 'RETURN_DRIVER_ALLOWANCE');
    expect(returnLine?.amountPaise).toBe(630_000); // 315,000 * 2
    expect(returnLine?.label).toBe('Return trip allowance for your driver × 2 days');
    expect(quote.distanceKm).toBe(88);
    expect(quote.direction).toBe('ONE_WAY');
  });

  it('refuses a one-way trip whose computed forward days exceeds outstation.max_trip_days', async () => {
    const packages = outstationPackages();
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { hill: hillZone }),
      packages,
      settings,
      distance(88, 160 * 60), // 160 hours -> 16 forward days > 15 max days
      repo,
    );

    await expect(
      useCase.execute({
        customerId: 'cus_1',
        pickup: SILIGURI,
        drop: DARJEELING,
        direction: 'ONE_WAY',
      }),
    ).rejects.toThrow('We can only book an outstation trip up to 15 days.');
  });

  it('gracefully falls back to single-day price when travelDurationMinutes returns null', async () => {
    const packages = outstationPackages();
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { hill: hillZone }),
      packages,
      settings,
      distance(88, null), // distance measured, duration returned null
      repo,
    );

    const result = await useCase.execute({
      customerId: 'cus_1',
      pickup: SILIGURI,
      drop: DARJEELING,
      direction: 'ONE_WAY',
    });

    expect(result.available).toBe(true);
    if (!result.available) return;

    const quote = result.quotes[0]!;
    expect(quote.fare.lines.find((l) => l.code === 'RETURN_DRIVER_ALLOWANCE')).toBeUndefined();
    expect(quote.fare.lines[0]?.amountPaise).toBe(450_000);
  });

  it('generates options for active outstation variants alongside the distance option', async () => {
    const packagesWithVariants: PackageLookupContract = {
      resolveForTrip: vi.fn(async () => ({
        available: true as const,
        match: {
          type: 'OUTSTATION' as const,
          package: {
            id: 'pkg_out_var',
            name: 'PKG-VAR',
            terrain: 'PLAIN' as const,
            minKm: 50,
            maxKm: 100,
            oneWayFarePaise: 300_000,
            roundTripFarePaise: 500_000,
            oneWayDriverAmountPaise: 200_000,
            roundTripDriverAmountPaise: 350_000,
            variants: [
              {
                id: 'var_8h',
                label: '8 Hours',
                includedMinutes: 480,
                baseFarePaise: 250_000,
                driverAmountPaise: 180_000,
                isActive: true,
              },
            ],
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          farePaise: 300_000,
          direction: 'ONE_WAY' as const,
          variants: [
            {
              id: 'var_8h',
              label: '8 Hours',
              includedMinutes: 480,
              baseFarePaise: 250_000,
              driverAmountPaise: 180_000,
              isActive: true,
            },
          ],
        },
      })),
    };

    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { hill: null }),
      packagesWithVariants,
      settings,
      distance(60, 180),
      repo,
    );

    const result = await useCase.execute({
      customerId: 'cus_1',
      pickup: SILIGURI,
      drop: DARJEELING,
      direction: 'ONE_WAY',
    });

    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.quotes).toHaveLength(2);

    // 1st quote: distance band quote
    const distQuote = result.quotes[0]!;
    expect(distQuote.includedMinutes).toBeNull();
    expect(distQuote.fare.split.driverAmountPaise).toBe(200_000);
    expect(distQuote.fare.lines[0]?.amountPaise).toBe(300_000);
    expect(distQuote.fare.subtotalPaise).toBe(303_000);

    // 2nd quote: hourly variant quote
    const varQuote = result.quotes[1]!;
    expect(varQuote.includedMinutes).toBe(480);
    expect(varQuote.source.variantId).toBe('var_8h');
    expect(varQuote.source.variantLabel).toBe('8 Hours');
    expect(varQuote.fare.split.driverAmountPaise).toBe(180_000);
    expect(varQuote.fare.lines[0]?.amountPaise).toBe(250_000);
    expect(varQuote.fare.subtotalPaise).toBe(253_000);
  });
});
