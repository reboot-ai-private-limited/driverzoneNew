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
  const zone2 = new mongoose.Types.ObjectId().toHexString();
  const car1 = new mongoose.Types.ObjectId().toHexString();

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
        pickupZoneIds: [zone1],
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
        pickupZoneIds: [zone1],
        prices: [{
          carCategoryId: car1,
          direction: 'ONE_WAY',
          baseFarePaise: 1000,
          driverCommissionType: 'PERCENT',
          driverCommissionValue: 10,
          companyCommissionType: 'PERCENT',
          companyCommissionValue: 10,
        }],
      });

      // New: 150 - 250
      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 150,
        maxKm: 250,
        pickupZoneIds: [zone1],
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
        pickupZoneIds: [zone1],
        prices: [{
          carCategoryId: car1,
          direction: 'ONE_WAY',
          baseFarePaise: 1000,
          driverCommissionType: 'PERCENT',
          driverCommissionValue: 10,
          companyCommissionType: 'PERCENT',
          companyCommissionValue: 10,
        }],
      });

      // New: 150 - 250
      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 150,
        maxKm: 250,
        pickupZoneIds: [zone1],
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
        pickupZoneIds: [zone1],
        prices: [{
          carCategoryId: car1,
          direction: 'ONE_WAY',
          baseFarePaise: 1000,
          driverCommissionType: 'PERCENT',
          driverCommissionValue: 10,
          companyCommissionType: 'PERCENT',
          companyCommissionValue: 10,
        }],
      });

      // New: 100 - 300
      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 300,
        pickupZoneIds: [zone1],
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
        pickupZoneIds: [zone1],
        prices: [{
          carCategoryId: car1,
          direction: 'ONE_WAY',
          baseFarePaise: 1000,
          driverCommissionType: 'PERCENT',
          driverCommissionValue: 10,
          companyCommissionType: 'PERCENT',
          companyCommissionValue: 10,
        }],
      });

      // New: 200 - 300 (starts exactly where existing ends)
      const conflictAfter = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 200,
        maxKm: 300,
        pickupZoneIds: [zone1],
      });
      expect(conflictAfter).toBeNull();

      // New: 0 - 100 (ends exactly where existing starts)
      const conflictBefore = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 0,
        maxKm: 100,
        pickupZoneIds: [zone1],
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
        pickupZoneIds: [zone1],
        prices: [{
          carCategoryId: car1,
          direction: 'ONE_WAY',
          baseFarePaise: 1000,
          driverCommissionType: 'PERCENT',
          driverCommissionValue: 10,
          companyCommissionType: 'PERCENT',
          companyCommissionValue: 10,
        }],
      });

      // New: 100 - 200 HILL
      const conflict = await repo.findOverlappingBands({
        terrain: 'HILL',
        minKm: 100,
        maxKm: 200,
        pickupZoneIds: [zone1],
      });
      expect(conflict).toBeNull();
    });

    it('does not detect conflict if pickup zones do not overlap', async () => {
      // Existing: 100 - 200 in zone1
      await repo.createOutstation({
        name: 'Existing 100-200 zone1',
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
        pickupZoneIds: [zone1],
        prices: [{
          carCategoryId: car1,
          direction: 'ONE_WAY',
          baseFarePaise: 1000,
          driverCommissionType: 'PERCENT',
          driverCommissionValue: 10,
          companyCommissionType: 'PERCENT',
          companyCommissionValue: 10,
        }],
      });

      // New: 100 - 200 in zone2
      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
        pickupZoneIds: [zone2],
      });
      expect(conflict).toBeNull();
    });

    it('does not detect conflict with inactive packages', async () => {
      // Existing: 100 - 200 (Inactive)
      await repo.createOutstation({
        name: 'Existing 100-200 (Inactive)',
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
        pickupZoneIds: [zone1],
        isActive: false,
        prices: [{
          carCategoryId: car1,
          direction: 'ONE_WAY',
          baseFarePaise: 1000,
          driverCommissionType: 'PERCENT',
          driverCommissionValue: 10,
          companyCommissionType: 'PERCENT',
          companyCommissionValue: 10,
        }],
      });

      // New: 100 - 200
      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
        pickupZoneIds: [zone1],
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
        pickupZoneIds: [zone1],
        prices: [{
          carCategoryId: car1,
          direction: 'ONE_WAY',
          baseFarePaise: 1000,
          driverCommissionType: 'PERCENT',
          driverCommissionValue: 10,
          companyCommissionType: 'PERCENT',
          companyCommissionValue: 10,
        }],
      });

      // Check same band but exclude the package's own ID
      const conflict = await repo.findOverlappingBands({
        terrain: 'PLAIN',
        minKm: 100,
        maxKm: 200,
        pickupZoneIds: [zone1],
        excludeId: pkg.id,
      });

      expect(conflict).toBeNull();
    });
  });
});
