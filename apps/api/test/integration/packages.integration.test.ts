import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../../src/shared/db/mongo.js';
import { loadEnv } from '../../src/config/env.js';
import { MongoPackageRepository } from '../../src/modules/packages/infrastructure/packageRepository.impl.js';
import { OutstationPackageModel } from '../../src/modules/packages/infrastructure/outstationPackage.model.js';
import { IncityPackageModel } from '../../src/modules/packages/infrastructure/incityPackage.model.js';

describe('Packages Repository Integration', () => {
  let repo: MongoPackageRepository;
  const zone1 = new mongoose.Types.ObjectId().toHexString();

  /**
   * The fare a band needs to exist at all. Every test here is about band GEOMETRY, not pricing,
   * so they all spread this rather than restating it. It is two fields now: pricing by car
   * category was retired 2026-08-28 and the `prices[]` subdocument went with it.
   */
  const FARE = {
    oneWayFarePaise: 1000,
    driverCommissionBps: 7500,
  } as const;

  beforeAll(async () => {
    // This will fail the test suite immediately if MONGO_URI is missing.
    loadEnv();
    await connectMongo();
    repo = new MongoPackageRepository();
  });

  afterAll(async () => {
    await disconnectMongo();
  });

  beforeEach(async () => {
    await OutstationPackageModel.deleteMany({});
    await IncityPackageModel.deleteMany({});
  });

  describe('Outstation findOverlappingBands', () => {
    it('returns null if there are no existing packages', async () => {
      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
      });
      expect(conflict).toBeNull();
    });

    it('detects a conflict when a new band falls completely within an existing band', async () => {
      // Existing: 100 - 300
      await repo.createOutstation({
        name: 'Existing 100-300',
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 300,
        ...FARE,
      });

      // New: 150 - 250
      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 150,
        maxKm: 250,
      });

      expect(conflict).not.toBeNull();
      expect(conflict?.name).toBe('Existing 100-300');
    });

    it('detects a conflict when a new band partially overlaps at the end', async () => {
      // Existing: 100 - 200
      await repo.createOutstation({
        name: 'Existing 100-200',
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
        ...FARE,
      });

      // New: 150 - 250
      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 150,
        maxKm: 250,
      });

      expect(conflict).not.toBeNull();
      expect(conflict?.name).toBe('Existing 100-200');
    });

    it('detects a conflict when a new band completely envelopes an existing band', async () => {
      // Existing: 150 - 250
      await repo.createOutstation({
        name: 'Existing 150-250',
        terrain: 'PLAIN',
        minKm: 150,
        maxKm: 250,
        ...FARE,
      });

      // New: 100 - 300
      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 300,
      });

      expect(conflict).not.toBeNull();
    });

    it('does not detect conflict when bands touch exactly at boundaries (half-open)', async () => {
      // Existing: 100 - 200
      await repo.createOutstation({
        name: 'Existing 100-200',
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
        ...FARE,
      });

      // New: 200 - 300 (starts exactly where existing ends)
      const conflictAfter = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 200,
        maxKm: 300,
      });
      expect(conflictAfter).toBeNull();

      // New: 0 - 100 (ends exactly where existing starts)
      const conflictBefore = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 0,
        maxKm: 100,
      });
      expect(conflictBefore).toBeNull();
    });

    it('does not detect conflict if terrain differs', async () => {
      // Existing: 100 - 200 PLAIN
      await repo.createOutstation({
        name: 'Existing 100-200 PLAIN',
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
        ...FARE,
      });

      // New: 100 - 200 HILL
      const conflict = await repo.findOverlappingBands({
        terrain: 'HILL',
        minKm: 100,
        maxKm: 200,
      });
      expect(conflict).toBeNull();
    });

    it('detects a conflict on the same terrain regardless of any zone — terrain is the whole scope', async () => {
      // The predecessor of this test asserted the opposite: that two packages covering the same
      // band on the same terrain did NOT conflict as long as their `pickupZoneIds` differed.
      // That scoping was retired with invariant P-1 (docs/decision-log.md, 2026-08-25) — packages
      // reference no pickup zone at all — so the overlap is now real and must be caught.
      await repo.createOutstation({
        name: 'Existing 100-200',
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
        ...FARE,
      });

      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
      });
      expect(conflict).not.toBeNull();
      expect(conflict?.name).toBe('Existing 100-200');
    });

    it('does not detect conflict with inactive packages', async () => {
      // Existing: 100 - 200 (Inactive)
      await repo.createOutstation({
        name: 'Existing 100-200 (Inactive)',
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
        isActive: false,
        ...FARE,
      });

      // New: 100 - 200
      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
      });

      expect(conflict).toBeNull();
    });

    it('excludes specified ID from conflict check', async () => {
      // Existing: 100 - 200
      const pkg = await repo.createOutstation({
        name: 'Existing 100-200',
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
        ...FARE,
      });

      // Check same band but exclude the package's own ID
      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
        excludeId: pkg.id,
      });

      expect(conflict).toBeNull();
    });
  });

  /**
   * `beforeEach` truncates `IncityPackageModel` too, so this exercises what that is clearing.
   * `findIncityForQuote` is the read half of the resolution path and the only incity query that
   * runs against real Mongo — the unit suite drives it through a fake.
   */
  describe('findIncityForQuote', () => {
    const incityPackage = {
      cityZoneId: zone1,
      name: 'Siliguri Hourly',
      variants: [
        {
          label: '3 Hours',
          includedMinutes: 180,
          includedKm: 30,
          baseFarePaise: 90000,
          driverCommissionBps: 7500,
        },
      ],
    } as const;

    it('returns the active package for the city zone, with its variants mapped', async () => {
      await repo.createIncity(incityPackage);

      const found = await repo.findIncityForQuote({ cityZoneId: zone1 });

      expect(found).toHaveLength(1);
      expect(found[0]?.name).toBe('Siliguri Hourly');
      expect(found[0]?.variants[0]?.includedMinutes).toBe(180);
      expect(found[0]?.variants[0]?.baseFarePaise).toBe(90000);
      // Defaults come from the schema, so the mapper has to carry them back out.
      expect(found[0]?.variants[0]?.extraKmRatePaise).toBe(0);
      expect(found[0]?.variants[0]?.extraMinuteRatePaise).toBe(0);
      expect(found[0]?.variants[0]?.isActive).toBe(true);
    });

    it('does not return a package belonging to a different city zone', async () => {
      await repo.createIncity(incityPackage);

      const otherCity = new mongoose.Types.ObjectId().toHexString();
      expect(await repo.findIncityForQuote({ cityZoneId: otherCity })).toHaveLength(0);
    });

    it('does not return an inactive package', async () => {
      await repo.createIncity({ ...incityPackage, isActive: false });

      expect(await repo.findIncityForQuote({ cityZoneId: zone1 })).toHaveLength(0);
    });
  });

  /**
   * The one thing only real Mongo can settle: that an omitted return fare comes back as `null`
   * and not as `0` or `undefined`. The schema default and the mapper's `?? null` have to agree,
   * and a fake repository would happily return whatever the test put in.
   */
  describe('roundTripFarePaise round-trips as null, never zero', () => {
    it('stores an omitted return fare as null', async () => {
      const band = await repo.createOutstation({
        name: 'One-way only',
        terrain: 'HILL',
        minKm: 200,
        maxKm: 300,
        ...FARE,
      });

      expect(band.roundTripFarePaise).toBeNull();

      const reread = await repo.findOutstationById(band.id);
      expect(reread?.roundTripFarePaise).toBeNull();
      expect(reread?.roundTripFarePaise).not.toBe(0);
    });

    it('keeps a real return fare, including a deliberate zero', async () => {
      const band = await repo.createOutstation({
        name: 'Free return',
        terrain: 'PLAIN',
        minKm: 200,
        maxKm: 300,
        ...FARE,
        roundTripFarePaise: 0,
      });

      // A band that genuinely charges nothing for the return is distinguishable from one that
      // does not sell it. That distinction is the reason the field is nullable.
      expect(band.roundTripFarePaise).toBe(0);
    });
  });
});
