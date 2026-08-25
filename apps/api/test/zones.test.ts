import { describe, expect, it } from 'vitest';
import type { Polygon } from '@driverzone/geo';
import { CreateZoneUseCase } from '../src/modules/zones/application/useCases/createZone.usecase.js';
import { UpdateZoneGeometryUseCase } from '../src/modules/zones/application/useCases/updateZoneGeometry.usecase.js';
import { UpdateZoneMetadataUseCase } from '../src/modules/zones/application/useCases/updateZoneMetadata.usecase.js';
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
  ZoneMetadataPatch,
  ZoneRepositoryPort,
} from '../src/modules/zones/domain/zone.repository.port.js';
import type { AppError } from '../src/shared/errors/AppError.js';

/**
 * The zones module's invariants and lifecycle rules, exercised without Mongo — the same
 * approach as `identity.test.ts`. `CreateZoneUseCase`/`UpdateZoneGeometryUseCase`/
 * `ValidateZoneGeometryUseCase` call the REAL `validateZone()`/`normalizeWinding()` from
 * `@driverzone/geo` (already tested in `packages/geo`), so these tests exercise real Z-2/Z-3
 * geometry, not a mock of it.
 *
 * Reflects the 2026-08-25 redesign: pickup zones have no parent (Z-1 retired), deactivation is
 * unconditional (no `force`, no hard delete), geometry edits require `expectedVersion`, and
 * metadata edits are a separate use case from geometry edits.
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

/** Fully inside CITY — but that no longer matters, since PICKUP has no parent to check against. */
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

/** Nowhere near CITY — legal now that Z-1 is retired (e.g. an airport pickup outside town). */
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

/** A second pickup zone, far from the others — never overlaps anything above. */
const OTHER_PICKUP: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [90.0, 27.0],
      [90.1, 27.0],
      [90.1, 27.1],
      [90.0, 27.1],
      [90.0, 27.0],
    ],
  ],
};

/** Self-intersecting — a Z-3 violation, independent of type. */
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
 * whatever the test pre-loads via `setContaining`. Real spatial resolution is Mongo's
 * `$geoIntersects`, exercised in `zone.repository.impl.ts`, not in these use-case tests.
 */
function fakeZones(seed: Zone[] = []): ZoneRepositoryPort & {
  all: Map<string, Zone>;
  setContaining: (zones: Zone[]) => void;
} {
  const all = new Map(seed.map((z) => [z.id, z]));
  let containing: Zone[] = [];
  let counter = 0;

  return {
    all,
    setContaining: (zones) => {
      containing = zones;
    },

    findMany: (filter: ZoneListFilter) => {
      const wantActive = filter.isActive ?? true;
      const list = Array.from(all.values()).filter(
        (z) => z.isActive === wantActive && (filter.type === undefined || z.type === filter.type),
      );
      return Promise.resolve(list);
    },
    findContaining: () => Promise.resolve(containing),
    findById: (id) => Promise.resolve(all.get(id)),
    findByCode: (code) =>
      Promise.resolve(Array.from(all.values()).find((z) => z.code === code && z.isActive)),
    findSiblingsOfType: (type, excludeId) =>
      Promise.resolve(
        Array.from(all.values())
          .filter((z) => z.type === type && z.isActive && z.id !== excludeId)
          .map((z) => ({ id: z.id, name: z.name, geom: z.geometry })),
      ),
    findHillZonesIntersecting: () => Promise.resolve([]),

    save: (zone: NewZone) => {
      counter += 1;
      const saved = makeZone({
        id: `zone_${counter}`,
        type: zone.type,
        name: zone.name,
        code: zone.code,
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
    replaceGeometry: (oldId, newZone: NewZone) => {
      counter += 1;
      const saved = makeZone({
        id: `zone_${counter}`,
        type: newZone.type,
        name: newZone.name,
        code: newZone.code,
        geometry: newZone.geometry,
        priority: newZone.priority,
        pickupChargeType: newZone.pickupChargeType,
        pickupChargePaise: newZone.pickupChargePaise,
        version: newZone.version,
        createdBy: newZone.createdBy,
      });
      all.set(saved.id, saved);
      const old = all.get(oldId);
      if (old !== undefined) all.set(oldId, { ...old, isActive: false, supersededBy: saved.id });
      return Promise.resolve(saved);
    },
    updateMetadata: (id, patch: ZoneMetadataPatch) => {
      const z = all.get(id);
      if (z === undefined) return Promise.resolve(undefined);
      const updated = { ...z, ...patch };
      all.set(id, updated);
      return Promise.resolve(updated);
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
  it('rejects a PICKUP zone with no charge type', async () => {
    const useCase = new CreateZoneUseCase(fakeZones(), fakeAudit());
    const code = await codeOfRejection(
      useCase.execute({ type: 'PICKUP', name: 'X', code: 'X', geometry: PICKUP_INSIDE }, ACTOR),
    );
    expect(code).toBe('VALIDATION_FAILED');
  });

  it('rejects a CITY zone that carries a pickup charge type', async () => {
    const useCase = new CreateZoneUseCase(fakeZones(), fakeAudit());
    const code = await codeOfRejection(
      useCase.execute(
        { type: 'CITY', name: 'Siliguri', code: 'SLG', geometry: CITY, pickupChargeType: 'FREE' },
        ACTOR,
      ),
    );
    expect(code).toBe('VALIDATION_FAILED');
  });

  it('allows a PICKUP zone drawn outside every CITY zone — Z-1 is retired', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', geometry: CITY })]);
    const useCase = new CreateZoneUseCase(zones, fakeAudit());

    const zone = await useCase.execute(
      { type: 'PICKUP', name: 'Bagdogra Airport', code: 'BAG', geometry: PICKUP_OUTSIDE, pickupChargeType: 'PAID' },
      ACTOR,
    );

    expect(zone.parentZoneId).toBeNull();
    expect(zone.isActive).toBe(true);
  });

  it('rejects a PICKUP zone that overlaps an active sibling — Z-2', async () => {
    const zones = fakeZones([
      makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE, pickupChargeType: 'FREE' }),
    ]);
    const useCase = new CreateZoneUseCase(zones, fakeAudit());

    const code = await codeOfRejection(
      useCase.execute(
        { type: 'PICKUP', name: 'Overlapper', code: 'OVL', geometry: PICKUP_INSIDE, pickupChargeType: 'FREE' },
        ACTOR,
      ),
    );
    expect(code).toBe('ZONE_VALIDATION_FAILED');
  });

  it('rejects a self-intersecting polygon — Z-3 — independent of type', async () => {
    const useCase = new CreateZoneUseCase(fakeZones(), fakeAudit());
    const code = await codeOfRejection(
      useCase.execute({ type: 'CITY', name: 'Bowtie', code: 'BOW', geometry: BOWTIE }, ACTOR),
    );
    expect(code).toBe('ZONE_VALIDATION_FAILED');
  });

  it('persists a valid zone with parentZoneId null and writes a CREATE audit entry', async () => {
    const zones = fakeZones();
    const audit = fakeAudit();
    const useCase = new CreateZoneUseCase(zones, audit);

    const zone = await useCase.execute(
      { type: 'CITY', name: 'Siliguri', code: 'SLG', geometry: CITY },
      ACTOR,
    );

    expect(zone.id).toBeDefined();
    expect(zone.version).toBe(1);
    expect(zone.parentZoneId).toBeNull();
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]?.action).toBe('CREATE');
  });

  it('normalizes a clockwise ring before validating and saving', async () => {
    const clockwise: Polygon = {
      type: 'Polygon',
      coordinates: [[...CITY.coordinates[0]!].reverse()],
    };
    const zones = fakeZones();
    const useCase = new CreateZoneUseCase(zones, fakeAudit());

    const zone = await useCase.execute(
      { type: 'CITY', name: 'Siliguri', code: 'SLG', geometry: clockwise },
      ACTOR,
    );

    expect(zone.geometry.coordinates).toEqual(CITY.coordinates);
  });
});

// ─── UpdateZoneGeometryUseCase — Z-5, never mutate in place ────────────────────────────────────

describe('UpdateZoneGeometryUseCase', () => {
  it('writes a new version and supersedes the old one rather than mutating it', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', code: 'SLG', geometry: CITY })]);
    const useCase = new UpdateZoneGeometryUseCase(zones, fakeAudit());

    const updated = await useCase.execute('city_1', { geometry: CITY, expectedVersion: 1 }, ACTOR);

    expect(updated.id).not.toBe('city_1');
    expect(updated.version).toBe(2);
    expect(updated.isActive).toBe(true);

    const old = await zones.findById('city_1');
    expect(old?.isActive).toBe(false);
    expect(old?.supersededBy).toBe(updated.id);
  });

  it('rejects a stale expectedVersion — two admins editing the same zone', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', geometry: CITY, version: 2 })]);
    const useCase = new UpdateZoneGeometryUseCase(zones, fakeAudit());
    const code = await codeOfRejection(
      useCase.execute('city_1', { geometry: CITY, expectedVersion: 1 }, ACTOR),
    );
    expect(code).toBe('ZONE_ALREADY_SUPERSEDED');
  });

  it('rejects editing a zone that has already been superseded', async () => {
    const zones = fakeZones([
      makeZone({ id: 'city_1', type: 'CITY', geometry: CITY, isActive: false, supersededBy: 'city_2' }),
    ]);
    const useCase = new UpdateZoneGeometryUseCase(zones, fakeAudit());
    expect(
      await codeOfRejection(useCase.execute('city_1', { geometry: CITY, expectedVersion: 1 }, ACTOR)),
    ).toBe('ZONE_ALREADY_SUPERSEDED');
  });

  it('rejects an unknown zone id', async () => {
    const useCase = new UpdateZoneGeometryUseCase(fakeZones(), fakeAudit());
    expect(
      await codeOfRejection(useCase.execute('missing', { geometry: CITY, expectedVersion: 1 }, ACTOR)),
    ).toBe('NOT_FOUND');
  });
});

// ─── UpdateZoneMetadataUseCase — separate from geometry edits ──────────────────────────────────

describe('UpdateZoneMetadataUseCase', () => {
  it('updates name/priority/charge without touching geometry or version', async () => {
    const zones = fakeZones([makeZone({ id: 'p1', type: 'PICKUP', geometry: PICKUP_INSIDE })]);
    const audit = fakeAudit();
    const useCase = new UpdateZoneMetadataUseCase(zones, audit);

    const updated = await useCase.execute(
      'p1',
      { name: 'Renamed', pickupChargeType: 'PAID', pickupChargePaise: 5000 },
      ACTOR,
    );

    expect(updated.name).toBe('Renamed');
    expect(updated.pickupChargeType).toBe('PAID');
    expect(updated.version).toBe(1);
    expect(updated.geometry).toEqual(PICKUP_INSIDE);
    expect(audit.entries[0]?.action).toBe('UPDATE');
  });

  it('rejects clearing the charge type on a PICKUP zone', async () => {
    const zones = fakeZones([
      makeZone({ id: 'p1', type: 'PICKUP', geometry: PICKUP_INSIDE, pickupChargeType: 'FREE' }),
    ]);
    const useCase = new UpdateZoneMetadataUseCase(zones, fakeAudit());
    const code = await codeOfRejection(useCase.execute('p1', { pickupChargeType: null }, ACTOR));
    expect(code).toBe('VALIDATION_FAILED');
  });

  it('rejects setting a charge type on a non-PICKUP zone', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', geometry: CITY })]);
    const useCase = new UpdateZoneMetadataUseCase(zones, fakeAudit());
    const code = await codeOfRejection(
      useCase.execute('city_1', { pickupChargeType: 'FREE' }, ACTOR),
    );
    expect(code).toBe('VALIDATION_FAILED');
  });

  it('rejects renaming the code to one already taken by another active zone', async () => {
    const zones = fakeZones([
      makeZone({ id: 'p1', type: 'PICKUP', code: 'A', geometry: PICKUP_INSIDE }),
      makeZone({ id: 'p2', type: 'PICKUP', code: 'B', geometry: OTHER_PICKUP }),
    ]);
    const useCase = new UpdateZoneMetadataUseCase(zones, fakeAudit());
    const code = await codeOfRejection(useCase.execute('p2', { code: 'A' }, ACTOR));
    expect(code).toBe('ZONE_CODE_TAKEN');
  });
});

// ─── ResolveZonesAtPointUseCase — the single query every quote depends on ──────────────────────

describe('ResolveZonesAtPointUseCase', () => {
  it('resolves city and pickup for a point both contain', async () => {
    const city = makeZone({ id: 'city_1', type: 'CITY', geometry: CITY });
    const pickup = makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE });
    const zones = fakeZones([city, pickup]);
    zones.setContaining([city, pickup]);

    const result = await new ResolveZonesAtPointUseCase(zones).execute({ lat: 26.7, lng: 88.4 });

    expect(result.city?.id).toBe('city_1');
    expect(result.pickup?.id).toBe('pickup_1');
    expect(result.hill).toBeNull();
  });

  it('resolves a pickup point outside every city — Z-1 is retired, no config fault', async () => {
    const pickup = makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_OUTSIDE });
    const zones = fakeZones([pickup]);
    zones.setContaining([pickup]); // no CITY zone matches this point at all

    const result = await new ResolveZonesAtPointUseCase(zones).execute({ lat: 27.05, lng: 89.05 });

    expect(result.city).toBeNull();
    expect(result.pickup?.id).toBe('pickup_1');
  });

  it('resolves nulls for a point nothing contains — the ZONE_NO_PICKUP_COVERAGE shape', async () => {
    const zones = fakeZones();
    zones.setContaining([]);

    const result = await new ResolveZonesAtPointUseCase(zones).execute({ lat: 26.7, lng: 88.4 });

    expect(result.city).toBeNull();
    expect(result.pickup).toBeNull();
    expect(result.all).toHaveLength(0);
  });

  it('allows two PICKUP zones matching the same border point — resolved by priority, not an error', async () => {
    const free = makeZone({ id: 'free', type: 'PICKUP', geometry: PICKUP_INSIDE, priority: 10 });
    const paid = makeZone({ id: 'paid', type: 'PICKUP', geometry: PICKUP_INSIDE, priority: 0 });
    const zones = fakeZones([free, paid]);
    // Repository already sorts by priority DESC; the fake mirrors that ordering here.
    zones.setContaining([free, paid]);

    const result = await new ResolveZonesAtPointUseCase(zones).execute({ lat: 26.7, lng: 88.4 });
    expect(result.pickup?.id).toBe('free');
  });

  it('throws AMBIGUOUS_ZONE_MATCH when two active CITY zones both contain the point', async () => {
    const cityA = makeZone({ id: 'city_a', type: 'CITY', geometry: CITY });
    const cityB = makeZone({ id: 'city_b', type: 'CITY', geometry: CITY });
    const zones = fakeZones([cityA, cityB]);
    zones.setContaining([cityA, cityB]);

    expect(
      await codeOfRejection(new ResolveZonesAtPointUseCase(zones).execute({ lat: 26.7, lng: 88.4 })),
    ).toBe('AMBIGUOUS_ZONE_MATCH');
  });

  it('rejects an implausible coordinate before ever querying the repository', async () => {
    const zones = fakeZones();
    // lat/lng swapped — 88.4 is not a valid latitude anywhere near India.
    await expect(new ResolveZonesAtPointUseCase(zones).execute({ lat: 88.4, lng: 26.7 })).rejects.toThrow();
  });
});

// ─── DeactivateZoneUseCase — unconditional, FR-Z6's replacement ────────────────────────────────

describe('DeactivateZoneUseCase', () => {
  it('is idempotent on an already-inactive zone', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', geometry: CITY, isActive: false })]);
    const useCase = new DeactivateZoneUseCase(zones, fakeAudit());
    const zone = await useCase.execute('city_1', ACTOR);
    expect(zone.isActive).toBe(false);
  });

  it('deactivates the last active PICKUP zone with no override needed', async () => {
    const zones = fakeZones([makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE })]);
    const audit = fakeAudit();
    const useCase = new DeactivateZoneUseCase(zones, audit);

    const zone = await useCase.execute('pickup_1', ACTOR);

    expect(zone.isActive).toBe(false);
    expect(audit.entries[0]?.action).toBe('UPDATE');
  });

  it('deactivates a CITY zone unconditionally', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', geometry: CITY })]);
    const zone = await new DeactivateZoneUseCase(zones, fakeAudit()).execute('city_1', ACTOR);
    expect(zone.isActive).toBe(false);
  });

  it('rejects an unknown zone id', async () => {
    const useCase = new DeactivateZoneUseCase(fakeZones(), fakeAudit());
    expect(await codeOfRejection(useCase.execute('missing', ACTOR))).toBe('NOT_FOUND');
  });
});

// ─── DeleteZoneUseCase — permanent, unlike DeactivateZoneUseCase ───────────────────────────────

describe('DeleteZoneUseCase', () => {
  it('blocks deleting a still-active zone', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', geometry: CITY })]);
    const useCase = new DeleteZoneUseCase(zones, fakeAudit());
    expect(await codeOfRejection(useCase.execute('city_1', ACTOR))).toBe('ZONE_STILL_ACTIVE');
  });

  it('deletes an inactive zone and writes a DELETE audit entry', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', geometry: CITY, isActive: false })]);
    const audit = fakeAudit();
    const useCase = new DeleteZoneUseCase(zones, audit);

    await useCase.execute('city_1', ACTOR);

    expect(await zones.findById('city_1')).toBeUndefined();
    expect(audit.entries[0]?.action).toBe('DELETE');
  });

  it('rejects an unknown zone id', async () => {
    const useCase = new DeleteZoneUseCase(fakeZones(), fakeAudit());
    expect(await codeOfRejection(useCase.execute('missing', ACTOR))).toBe('NOT_FOUND');
  });

  it('deactivate then delete succeeds end to end', async () => {
    const zones = fakeZones([makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE })]);
    const audit = fakeAudit();

    await new DeactivateZoneUseCase(zones, audit).execute('pickup_1', ACTOR);
    await new DeleteZoneUseCase(zones, audit).execute('pickup_1', ACTOR);

    expect(await zones.findById('pickup_1')).toBeUndefined();
  });
});

// ─── GetZoneDependentsUseCase — informational only, never blocks ──────────────────────────────

describe('GetZoneDependentsUseCase', () => {
  it('warns when this is the only active PICKUP zone', async () => {
    const zones = fakeZones([makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE })]);
    const result = await new GetZoneDependentsUseCase(zones).execute('pickup_1');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/all service stops/i);
  });

  it('has no warning for a PICKUP zone when another active one exists', async () => {
    const zones = fakeZones([
      makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE }),
      makeZone({ id: 'pickup_2', type: 'PICKUP', geometry: OTHER_PICKUP }),
    ]);
    const result = await new GetZoneDependentsUseCase(zones).execute('pickup_1');
    expect(result.warnings).toHaveLength(0);
  });

  it('warns about incity packages for a CITY zone', async () => {
    const zones = fakeZones([makeZone({ id: 'city_1', type: 'CITY', geometry: CITY })]);
    const result = await new GetZoneDependentsUseCase(zones).execute('city_1');
    expect(result.warnings).toHaveLength(1);
  });

  it('has no warnings for a HILL zone', async () => {
    const zones = fakeZones([makeZone({ id: 'hill_1', type: 'HILL', geometry: CITY })]);
    const result = await new GetZoneDependentsUseCase(zones).execute('hill_1');
    expect(result.warnings).toHaveLength(0);
  });
});

// ─── CheckCoverageUseCase ───────────────────────────────────────────────────────────────────────

describe('CheckCoverageUseCase', () => {
  it('reports covered when a pickup zone resolves', async () => {
    const city = makeZone({ id: 'city_1', type: 'CITY', geometry: CITY });
    const pickup = makeZone({ id: 'pickup_1', type: 'PICKUP', geometry: PICKUP_INSIDE });
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
