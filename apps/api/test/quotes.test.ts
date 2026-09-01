import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const distance = (km: number): RoadDistancePort => ({ roadDistanceKm: vi.fn(async () => km) });

const incityVariants = [
  {
    id: 'var_3h',
    label: '3 Hours',
    includedMinutes: 180,
    baseFarePaise: 90_000,
    driverCommissionBps: 7_500,
    isActive: true,
  },
  {
    id: 'var_6h',
    label: '6 Hours',
    includedMinutes: 360,
    baseFarePaise: 160_000,
    driverCommissionBps: 7_500,
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
          driverCommissionBps: 7_000,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        farePaise: 450_000,
        direction: 'ONE_WAY' as const,
      },
    })),
  };
}

let repo: ReturnType<typeof fakeRepo>;

beforeEach(() => {
  repo = fakeRepo();
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
    const useCase = new CreateQuoteUseCase(
      fakeZones({ city: cityZone, pickup: freePickup }, { city: cityZone }),
      incityPackages(),
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
});
