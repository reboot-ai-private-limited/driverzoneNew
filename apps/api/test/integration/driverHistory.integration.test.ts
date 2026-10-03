import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../../src/shared/db/mongo.js';
import { loadEnv } from '../../src/config/env.js';
import { MongoBookingRepository } from '../../src/modules/bookings/infrastructure/bookingRepository.impl.js';
import { BookingModel } from '../../src/modules/bookings/infrastructure/booking.model.js';
import { FareAdjustmentModel } from '../../src/modules/bookings/infrastructure/charge.model.js';
import type { DriverHistoryQuery } from '../../src/modules/bookings/domain/bookingRepository.port.js';

/**
 * The driver's trip-list paging against a real Mongo — the keyset cursor over a derived sort key
 * is only right if Mongo orders ties the way the `$or` after it assumes, which a fake cannot check.
 *
 * SCOPED TO ONE THROWAWAY DRIVER. This runs against the dev database, so it never deletes anything
 * it did not insert.
 */
describe('Driver trip history paging', () => {
  const repo = new MongoBookingRepository();
  const driverId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const now = new Date('2026-10-02T12:00:00Z');
  const ids: mongoose.Types.ObjectId[] = [];

  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

  function row(over: Record<string, unknown>) {
    const _id = new mongoose.Types.ObjectId();
    ids.push(_id);
    return {
      _id,
      reference: `T-${_id.toHexString().slice(-8)}`,
      customerId,
      quoteId: new mongoose.Types.ObjectId(),
      driverId,
      status: 'COMPLETED',
      serviceType: 'HOURLY',
      pickup: { lat: 22.5, lng: 88.3 },
      pickupAddress: 'Park Street',
      drop: { lat: 22.6, lng: 88.4 },
      dropAddress: 'Salt Lake',
      fareSnapshot: { fare: { totalPaise: 50_000 } },
      walletCreditPaise: 0,
      walletDebtPaise: 0,
      isScheduled: false,
      scheduledAt: ago(48),
      dispatchAt: ago(48),
      completedAt: null,
      cancelledAt: null,
      startOtp: '4821',
      otpAttempts: 0,
      createdAt: ago(48),
      updatedAt: ago(48),
      ...over,
    };
  }

  const base = (over: Partial<DriverHistoryQuery> = {}): DriverHistoryQuery => ({
    driverId: driverId.toHexString(),
    limit: 2,
    ...over,
  });

  let extended: mongoose.Types.ObjectId;

  beforeAll(async () => {
    loadEnv();
    await connectMongo();

    const docs = [
      row({ completedAt: ago(1), pickupAddress: 'Hakimpara' }),
      row({ status: 'CANCELLED_BY_CUSTOMER', cancelledAt: ago(2), scheduledAt: ago(3) }),
      row({ completedAt: ago(5), fareSnapshot: { fare: { totalPaise: 120_000 } } }),
      row({ status: 'STARTED', scheduledAt: ago(0.5) }),
      row({ completedAt: ago(30), waitingChargePaise: 5_000 }),
      // Another driver's trip — never in this list.
      row({ driverId: new mongoose.Types.ObjectId(), completedAt: ago(0.2) }),
    ];
    extended = docs[4]!._id;
    await BookingModel.collection.insertMany(docs);
    await FareAdjustmentModel.collection.insertOne({
      bookingId: extended,
      type: 'DAY_EXTENSION',
      amountPaise: 100_000,
      label: 'Extra day',
      settledByPaymentId: null,
      createdAt: now,
    });
  });

  afterAll(async () => {
    await BookingModel.collection.deleteMany({ _id: { $in: ids } });
    await FareAdjustmentModel.collection.deleteMany({ bookingId: extended });
    await disconnectMongo();
  });

  it('walks every trip exactly once, newest happening first, never carrying the trip code', async () => {
    const seen: string[] = [];
    let cursor: DriverHistoryQuery['cursor'];
    for (let i = 0; i < 5; i += 1) {
      const page = await repo.pageForDriver(base({ cursor }));
      seen.push(...page.bookings.map((b) => b.id));
      for (const b of page.bookings) expect((b as { startOtp?: unknown }).startOtp).toBeUndefined();
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual([ids[3], ids[0], ids[1], ids[2], ids[4]].map(String));
  });

  it('filters by group in the database', async () => {
    const group = async (g: DriverHistoryQuery['group']) =>
      (await repo.pageForDriver(base({ limit: 50, group: g }))).bookings.map((b) => b.id);
    expect(await group('COMPLETED')).toEqual([ids[0], ids[2], ids[4]].map(String));
    expect(await group('CANCELLED')).toEqual([String(ids[1])]);
    expect(await group('RUNNING')).toEqual([String(ids[3])]);
  });

  it('filters by when the trip happened, and searches addresses', async () => {
    const window = await repo.pageForDriver(base({ limit: 50, from: ago(6), before: ago(0.75) }));
    expect(window.bookings.map((b) => b.id)).toEqual([ids[0], ids[1], ids[2]].map(String));

    const byAddress = await repo.pageForDriver(base({ limit: 50, search: 'hakim' }));
    expect(byAddress.bookings.map((b) => b.id)).toEqual([String(ids[0])]);
  });

  it('summarises the whole history: every trip counted, completed fares with extras and waiting', async () => {
    expect(await repo.driverHistorySummary(driverId.toHexString())).toEqual({
      totalTrips: 5,
      completedTrips: 3,
      faresPaise: 50_000 + 120_000 + (50_000 + 100_000 + 5_000),
    });
  });
});
