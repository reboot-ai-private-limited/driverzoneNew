import { describe, expect, it } from 'vitest';
import type { Polygon } from '@driverzone/geo';
import { CreateZoneUseCase } from '../src/modules/zones/application/useCases/createZone.usecase.js';
import { UpdateZoneGeometryUseCase } from '../src/modules/zones/application/useCases/updateZoneGeometry.usecase.js';
import { ResolveZonesAtPointUseCase } from '../src/modules/zones/application/useCases/resolveZonesAtPoint.usecase.js';
import { DeactivateZoneUseCase } from '../src/modules/zones/application/useCases/deactivateZone.usecase.js';
import { DeleteZoneUseCase } from '../src/modules/zones/application/useCases/deleteZone.usecase.js';
import { GetZoneDependentsUseCase } from '../src/modules/zones/application/useCases/getZoneDependents.usecase.js';
import { CheckCoverageUseCase } from '../src/modules/zones/application/useCases/checkCoverage.usecase.js';
import type { ActorContext } from '../src/modules/zones/application/actorContext.js';
import type { AuditEntry, AuditPort } from '../src/modules/zones/domain/audit.port.js';
import type { Zone } from '../src/modules/zones/domain/zone.entity.js';
import type {
  NewZone,
  ZoneListFilter,
  ZoneRepositoryPort,
} from '../src/modules/zones/domain/zone.repository.port.js';
import type { AppError } from '../src/shared/errors/AppError.js';

/**
 * The zones module's invariants and lifecycle rules, exercised without Mongo — the same
 * approach as `identity.test.ts`. `CreateZoneUseCase`/`UpdateZoneGeometryUseCase`/
 * `ValidateZoneGeometryUseCase` call the REAL `validateZone()` from `@driverzone/geo` (already
 * tested in `packages/geo`), so these tests exercise real Z-1/Z-2/Z-3 geometry, not a mock of it
 * — only persistence is faked.
 */

const ACTOR: ActorContext = { adminId: 'admin_1', ip: '127.0.0.1' };

// ─── Fixtures — small polygons around Siliguri, matching packages/geo/test/fixtures.ts's style ──

const CITY: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [88.3, 26.6],
      [88.5, 26.6],
      [88.5, 26.8],
      [88.3, 26.8],
      [88.3, 26.6],
    ],
  ],
};

/** Fully inside CITY. */
const PICKUP_INSIDE: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [88.35, 26.65],
      [88.45, 26.65],
      [88.45, 26.75],
      [88.35, 26.75],
      [88.35, 26.65],
    ],
  ],
};

/** Nowhere near CITY — a straightforward Z-1 violation. */
const PICKUP_OUTSIDE: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [89.0, 27.0],
      [89.1, 27.0],
      [89.1, 27.1],
      [89.0, 27.1],
      [89.0, 27.0],
    ],
  ],
};

/** Self-intersecting — a Z-3 violation, independent of any parent/sibling. */
const BOWTIE: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [88.3, 26.6],
      [88.5, 26.8],
      [88.5, 26.6],
      [88.3, 26.8],
      [88.3, 26.6],
    ],
  ],
};

// ─── Fakes ──────────────────────────────────────────────────────────────────────────────────

function makeZone(overrides: Partial<Zone> & Pick<Zone, 'id' | 'type' | 'geometry'>): Zone {
  return {
    name: 'Test Zone',
    code: overrides.id,
    parentZoneId: null,
    priority: 0,
    pickupChargeType: null,
    pickupChargePaise: null,
    version: 1,
    supersededBy: null,
    isActive: true,
    createdBy: 'admin_1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * `findContaining`/`findHillZonesIntersecting` don't run real geometry here — they return
 * whatever the test pre-loads via `setContaining`/`setHillMatches`. Real spatial resolution is
 * Mongo's `$geoIntersects`, exercised in `zone.repository.impl.ts`, not in these use-case tests;
 * what's under test here is how each use case *reacts* to what the repository returns.
 */
function fakeZones(seed: Zone[] = []): ZoneRepositoryPort & {
  all: Map<string, Zone>;
  setContaining: (zones: Zone[]) => void;
  setHillMatches: (zones: Zone[]) => void;
} {
  const all = new Map(seed.map((z) => [z.id, z]));
  let containing: Zone[] = [];
  let hillMatches: Zone[] = [];
  let counter = 0;

  return {
    all,
    setContaining: (zones) => {
      containing = zones;
    },
    setHillMatches: (zones) => {
      hillMatches = zones;
    },

    findMany: (filter: ZoneListFilter) => {
      const wantActive = filter.isActive ?? true;
      const list = Array.from(all.values()).filter(
        (z) =>
          z.isActive === wantActive &&
          (filter.type === undefined || z.type === filter.type) &&
          (filter.parentZoneId === undefined || z.parentZoneId === filter.parentZoneId),
      );
      return Promise.resolve(list);
    },
    findContaining: () => Promise.resolve(containing),
    findById: (id) => Promise.resolve(all.get(id)),
    findByCode: (code) =>
      Promise.resolve(Array.from(all.values()).find((z) => z.code === code && z.isActive)),
    findChildren: (parentZoneId) =>
      Promise.resolve(
        Array.from(all.values()).filter((z) => z.parentZoneId === parentZoneId && z.isActive),
      ),
    findSiblingsOfType: (type, excludeId) =>
      Promise.resolve(
        Array.from(all.values())
          .filter((z) => z.type === type && z.isActive && z.id !== excludeId)
          .map((z) => ({ id: z.id, name: z.name, geom: z.geometry })),
      ),
    findHillZonesIntersecting: () => Promise.resolve(hillMatches),

    save: (zone: NewZone) => {
      counter += 1;
      const saved = makeZone({
        id: `zone_${counter}`,
        type: zone.type,
        name: zone.name,
        code: zone.code,
        parentZoneId: zone.parentZoneId,
        geometry: zone.geometry,
        priority: zone.priority,
        pickupChargeType: zone.pickupChargeType,
        pickupChargePaise: zone.pickupChargePaise,
        version: zone.version,
        createdBy: zone.createdBy,
      });
      all.set(saved.id, saved);
      return Promise.resolve(saved);
    },
    supersede: (oldId, newId) => {
      const old = all.get(oldId);
      if (old !== undefined) all.set(oldId, { ...old, isActive: false, supersededBy: newId });
      return Promise.resolve();
    },
    setActive: (id, isActive) => {
      const z = all.get(id);
      if (z !== undefined) all.set(id, { ...z, isActive });
      return Promise.resolve();
    },
    deleteById: (id) => {
      all.delete(id);
      return Promise.resolve();
    },
  };
}

function fakeAudit(): AuditPort & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return {
    entries,
    record: (entry) => {
      entries.push(entry);
      return Promise.resolve();
    },
  };
}

async function codeOfRejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'DID_NOT_THROW';
  } catch (err) {
    return (err as AppError).code;
  }
}

// ─── CreateZoneUseCase — the invariant choke point ─────────────────────────────────────────────

describe('CreateZoneUseCase', () => {
  it('rejects a PICKUP zone with no parent', async () => {
    const useCase = new CreateZoneUseCase(fakeZones(), fakeAudit());
    const code = await codeOfRejection(
      useCase.execute({ type: 'PICKUP', name: 'X', code: 'X', geometry: PICKUP_INSIDE }, ACTOR),
    );
    expect(code).toBe('VALIDATION_FAILED');
  });

  it('rejects a PICKUP zone drawn outside its parent city — Z-1', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', geometry: CITY })]);
    const useCase = new CreateZoneUseCase(zones, fakeAudit());

    try {
      await useCase.execute(
        {
          type: 'PICKUP',
          name: 'Outside',
          code: 'OUT',
          parentZoneId: 'city_1',
          geometry: PICKUP_OUTSIDE,
          pickupChargeType: 'FREE',
        },
        ACTOR,
      );
      expect.unreachable('should have thrown on Z-1');
    } catch (err) {
      const violations = (err as AppError).publicDetails as { violations: { rule: string }[] };
      expect(violations.violations.some((v) => v.rule === 'Z-1')).toBe(true);
    }
  });

  it('rejects a PICKUP zone that overlaps an active sibling — Z-2', async () => {
    const zones = fakeZones([
      makeZone({ id: 'city_1', type: 'CITY', geometry: CITY }),
      makeZone({
        id: 'pickup_1',
        type: 'PICKUP',
        geometry: PICKUP_INSIDE,
        parentZoneId: 'city_1',
        pickupChargeType: 'FREE',
      }),
    ]);
    const useCase = new CreateZoneUseCase(zones, fakeAudit());

    const code = await codeOfRejection(
      useCase.execute(
        {
          type: 'PICKUP',
          name: 'Overlapper',
          code: 'OVL',
          parentZoneId: 'city_1',
          geometry: PICKUP_INSIDE, // identical to pickup_1 — a full overlap
          pickupChargeType: 'FREE',
        },
        ACTOR,
      ),
    );
    expect(code).toBe('VALIDATION_FAILED');
  });

  it('rejects a self-intersecting polygon — Z-3 — independent of type', async () => {
    const useCase = new CreateZoneUseCase(fakeZones(), fakeAudit());
    const code = await codeOfRejection(
      useCase.execute({ type: 'CITY', name: 'Bowtie', code: 'BOW', geometry: BOWTIE }, ACTOR),
    );
    expect(code).toBe('VALIDATION_FAILED');
  });

  it('persists a valid zone and writes a CREATE audit entry', async () => {
    const zones = fakeZones();
    const audit = fakeAudit();
    const useCase = new CreateZoneUseCase(zones, audit);

    const zone = await useCase.execute(
      { type: 'CITY', name: 'Siliguri', code: 'SLG', geometry: CITY },
      ACTOR,
    );

    expect(zone.id).toBeDefined();
    expect(zone.version).toBe(1);
    expect(zone.isActive).toBe(true);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]?.action).toBe('CREATE');
  });
});

// ─── UpdateZoneGeometryUseCase — Z-5, never mutate in place ────────────────────────────────────

describe('UpdateZoneGeometryUseCase', () => {
  it('writes a new version and supersedes the old one rather than mutating it', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', code: 'SLG', geometry: CITY })]);
    const useCase = new UpdateZoneGeometryUseCase(zones, fakeAudit());

    const updated = await useCase.execute('city_1', { geometry: CITY }, ACTOR);

    expect(updated.id).not.toBe('city_1');
    expect(updated.version).toBe(2);
    expect(updated.isActive).toBe(true);

    const old = await zones.findById('city_1');
    expect(old?.isActive).toBe(false);
    expect(old?.supersededBy).toBe(updated.id);
  });

  it('rejects editing a zone that has already been superseded', async () => {
    const zones = fakeZones([
      makeZone({ id: 'city_1', type: 'CITY', geometry: CITY, isActive: false, supersededBy: 'city_2' }),
    ]);
    const useCase = new UpdateZoneGeometryUseCase(zones, fakeAudit());
    expect(await codeOfRejection(useCase.execute('city_1', { geometry: CITY }, ACTOR))).toBe('CONFLICT');
  });

  it('rejects an unknown zone id', async () => {
    const useCase = new UpdateZoneGeometryUseCase(fakeZones(), fakeAudit());
    expect(await codeOfRejection(useCase.execute('missing', { geometry: CITY }, ACTOR))).toBe('NOT_FOUND');
  });
});

// ─── ResolveZonesAtPointUseCase — the single query every quote depends on ──────────────────────

describe('ResolveZonesAtPointUseCase', () => {
  it('resolves city and pickup for a point both contain', async () => {
    const city = makeZone({ id: 'city_1', type: 'CITY', geometry: CITY });
    const pickup = makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE, parentZoneId: 'city_1' });
    const zones = fakeZones([city, pickup]);
    zones.setContaining([city, pickup]);

    const result = await new ResolveZonesAtPointUseCase(zones).execute({ lat: 26.7, lng: 88.4 });

    expect(result.city?.id).toBe('city_1');
    expect(result.pickup?.id).toBe('pickup_1');
    expect(result.hill).toBeNull();
  });

  it('resolves nulls for a point nothing contains — the ZONE_NO_PICKUP_COVERAGE shape', async () => {
    const zones = fakeZones();
    zones.setContaining([]);

    const result = await new ResolveZonesAtPointUseCase(zones).execute({ lat: 26.7, lng: 88.4 });

    expect(result.city).toBeNull();
    expect(result.pickup).toBeNull();
    expect(result.all).toHaveLength(0);
  });

  it('throws AMBIGUOUS_ZONE_MATCH when two active zones of one type both contain the point', async () => {
    const cityA = makeZone({ id: 'city_a', type: 'CITY', geometry: CITY });
    const cityB = makeZone({ id: 'city_b', type: 'CITY', geometry: CITY });
    const zones = fakeZones([cityA, cityB]);
    zones.setContaining([cityA, cityB]);

    expect(
      await codeOfRejection(new ResolveZonesAtPointUseCase(zones).execute({ lat: 26.7, lng: 88.4 })),
    ).toBe('AMBIGUOUS_ZONE_MATCH');
  });

  it('throws ZONE_CONFIG_FAULT when a resolved PICKUP\'s parent is not the resolved CITY', async () => {
    const city = makeZone({ id: 'city_1', type: 'CITY', geometry: CITY });
    // Registered parent is a DIFFERENT city than the one that actually resolved at this point —
    // exactly the drift Z-1 is supposed to make impossible.
    const pickup = makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE, parentZoneId: 'some_other_city' });
    const zones = fakeZones([city, pickup]);
    zones.setContaining([city, pickup]);

    expect(
      await codeOfRejection(new ResolveZonesAtPointUseCase(zones).execute({ lat: 26.7, lng: 88.4 })),
    ).toBe('ZONE_CONFIG_FAULT');
  });

  it('rejects an implausible coordinate before ever querying the repository', async () => {
    const zones = fakeZones();
    // lat/lng swapped — 88.4 is not a valid latitude anywhere near India.
    await expect(new ResolveZonesAtPointUseCase(zones).execute({ lat: 88.4, lng: 26.7 })).rejects.toThrow();
  });
});

// ─── DeactivateZoneUseCase / DeleteZoneUseCase — FR-Z6 ─────────────────────────────────────────

describe('DeactivateZoneUseCase', () => {
  it('is idempotent on an already-inactive zone', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', geometry: CITY, isActive: false })]);
    const useCase = new DeactivateZoneUseCase(zones, fakeAudit());
    const zone = await useCase.execute('city_1', {}, ACTOR);
    expect(zone.isActive).toBe(false);
  });

  it('blocks deactivating a CITY with active PICKUP children unless forced', async () => {
    const zones = fakeZones([
      makeZone({ id: 'city_1', type: 'CITY', geometry: CITY }),
      makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE, parentZoneId: 'city_1' }),
    ]);
    const useCase = new DeactivateZoneUseCase(zones, fakeAudit());

    expect(await codeOfRejection(useCase.execute('city_1', {}, ACTOR))).toBe('CONFLICT');

    const forced = await useCase.execute('city_1', { force: true }, ACTOR);
    expect(forced.isActive).toBe(false);
  });
});

describe('DeleteZoneUseCase', () => {
  it('blocks deleting a still-active zone', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', geometry: CITY })]);
    const useCase = new DeleteZoneUseCase(zones, fakeAudit());
    expect(await codeOfRejection(useCase.execute('city_1', ACTOR))).toBe('CONFLICT');
  });

  it('blocks deleting an inactive zone that a PICKUP still references as parent', async () => {
    const zones = fakeZones([
      makeZone({ id: 'city_1', type: 'CITY', geometry: CITY, isActive: false }),
      makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE, parentZoneId: 'city_1' }),
    ]);
    const useCase = new DeleteZoneUseCase(zones, fakeAudit());
    expect(await codeOfRejection(useCase.execute('city_1', ACTOR))).toBe('CONFLICT');
  });

  it('deletes an inactive, unreferenced zone and writes a DELETE audit entry', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', geometry: CITY, isActive: false })]);
    const audit = fakeAudit();
    const useCase = new DeleteZoneUseCase(zones, audit);

    await useCase.execute('city_1', ACTOR);

    expect(await zones.findById('city_1')).toBeUndefined();
    expect(audit.entries[0]?.action).toBe('DELETE');
  });
});

// ─── GetZoneDependentsUseCase ───────────────────────────────────────────────────────────────────

describe('GetZoneDependentsUseCase', () => {
  it('lists active PICKUP children for a CITY', async () => {
    const zones = fakeZones([
      makeZone({ id: 'city_1', type: 'CITY', geometry: CITY }),
      makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE, parentZoneId: 'city_1' }),
    ]);
    const result = await new GetZoneDependentsUseCase(zones).execute('city_1');
    expect(result.childPickupZones.map((z) => z.id)).toEqual(['pickup_1']);
  });

  it('reports no dependents for a non-CITY zone type', async () => {
    const zones = fakeZones([makeZone({ id: 'hill_1', type: 'HILL', geometry: CITY })]);
    const result = await new GetZoneDependentsUseCase(zones).execute('hill_1');
    expect(result.childPickupZones).toHaveLength(0);
  });
});

// ─── CheckCoverageUseCase ───────────────────────────────────────────────────────────────────────

describe('CheckCoverageUseCase', () => {
  it('reports covered when a pickup zone resolves', async () => {
    const city = makeZone({ id: 'city_1', type: 'CITY', geometry: CITY });
    const pickup = makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE, parentZoneId: 'city_1' });
    const zones = fakeZones([city, pickup]);
    zones.setContaining([city, pickup]);

    const result = await new CheckCoverageUseCase(new ResolveZonesAtPointUseCase(zones)).execute({
      lat: 26.7,
      lng: 88.4,
    });
    expect(result.covered).toBe(true);
  });

  it('reports not covered when no pickup zone resolves', async () => {
    const zones = fakeZones();
    zones.setContaining([]);
    const result = await new CheckCoverageUseCase(new ResolveZonesAtPointUseCase(zones)).execute({
      lat: 26.7,
      lng: 88.4,
    });
    expect(result.covered).toBe(false);
  });
});
