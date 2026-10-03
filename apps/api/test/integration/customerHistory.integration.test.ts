import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../../src/shared/db/mongo.js';
import { loadEnv } from '../../src/config/env.js';
import { MongoBookingRepository } from '../../src/modules/bookings/infrastructure/bookingRepository.impl.js';
import { BookingModel } from '../../src/modules/bookings/infrastructure/booking.model.js';
import { FareAdjustmentModel } from '../../src/modules/bookings/infrastructure/charge.model.js';
import type { CustomerHistoryQuery } from '../../src/modules/bookings/domain/bookingRepository.port.js';

/**
 * Ride-history paging against a real Mongo.
 *
 * The fakes cannot check this: the sort keys are computed inside an aggregation (`$ifNull` over
 * three dates, a `$lookup` for the extra day), and a keyset cursor is only right if Mongo orders
 * ties exactly the way the `$or` after it assumes.
 *
 * SCOPED TO ONE THROWAWAY CUSTOMER. This runs against the dev database, so it never deletes
 * anything it did not insert — no `deleteMany({})`.
 */
describe('Customer ride history paging', () => {
  const repo = new MongoBookingRepository();
  const customerId = new mongoose.Types.ObjectId();
  const driverId = new mongoose.Types.ObjectId();
  const now = new Date('2026-10-02T12:00:00Z');
  const ids: mongoose.Types.ObjectId[] = [];

  /** Hours before `now`. */
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

  function row(over: Record<string, unknown>) {
    const _id = new mongoose.Types.ObjectId();
    ids.push(_id);
    return {
      _id,
      reference: `T-${_id.toHexString().slice(-8)}`,
      customerId,
      quoteId: new mongoose.Types.ObjectId(),
      driverId: null,
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

  const base = (over: Partial<CustomerHistoryQuery> = {}): CustomerHistoryQuery => ({
    customerId: customerId.toHexString(),
    limit: 2,
    now,
    sort: 'NEWEST',
    ...over,
  });

  let extended: mongoose.Types.ObjectId;

  beforeAll(async () => {
    loadEnv();
    await connectMongo();

    const docs = [
      // Completed an hour ago though booked two days back — "happened" is the completion.
      row({ completedAt: ago(1), pickupAddress: 'Hakimpara', driverId }),
      row({ status: 'CANCELLED_BY_CUSTOMER', cancelledAt: ago(2), scheduledAt: ago(3) }),
      row({ completedAt: ago(5), fareSnapshot: { fare: { totalPaise: 120_000 } }, walletCreditPaise: 20_000 }),
      // Still for later: scheduled tomorrow.
      row({ status: 'CONFIRMED', isScheduled: true, scheduledAt: new Date(now.getTime() + 86_400_000) }),
      // Scheduled, but its hour has passed — running, not scheduled.
      row({ status: 'ASSIGNED', isScheduled: true, scheduledAt: ago(0.5) }),
      row({ completedAt: ago(30), waitingChargePaise: 5_000 }),
    ];
    extended = docs[5]!._id;
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

  it('walks every row exactly once, newest happening first', async () => {
    const seen: string[] = [];
    let cursor: CustomerHistoryQuery['cursor'];
    for (let i = 0; i < 10; i += 1) {
      const page = await repo.pageForCustomer(base({ cursor }));
      seen.push(...page.bookings.map((b) => b.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    // The scheduled-tomorrow trip "happens" latest, then the one completed an hour ago.
    expect(seen[0]).toBe(ids[3]!.toHexString());
    expect(seen[1]).toBe(ids[4]!.toHexString());
    expect(seen[2]).toBe(ids[0]!.toHexString());
  });

  it('never returns the trip code', async () => {
    const page = await repo.pageForCustomer(base({ limit: 50 }));
    const raw = await BookingModel.aggregate([{ $match: { _id: ids[0] } }]);
    expect(raw[0]?.startOtp).toBe('4821'); // the fixture really has one
    expect(JSON.stringify(page.bookings)).not.toContain('4821');
  });

  it('groups by what the customer sees', async () => {
    const group = async (g: CustomerHistoryQuery['group']) =>
      (await repo.pageForCustomer(base({ limit: 50, group: g }))).bookings.map((b) => b.id);

    expect(await group('SCHEDULED')).toEqual([ids[3]!.toHexString()]);
    expect(await group('RUNNING')).toEqual([ids[4]!.toHexString()]);
    expect(await group('CANCELLED')).toEqual([ids[1]!.toHexString()]);
    expect(await group('COMPLETED')).toHaveLength(3);
  });

  it('filters on when the ride happened', async () => {
    const page = await repo.pageForCustomer(base({ limit: 50, from: ago(6), before: ago(0.75) }));
    expect(page.bookings.map((b) => b.id).sort()).toEqual(
      [ids[0], ids[1], ids[2]].map((id) => id!.toHexString()).sort(),
    );
  });

  it('searches addresses and matched drivers', async () => {
    const byAddress = await repo.pageForCustomer(base({ limit: 50, search: 'hakim' }));
    expect(byAddress.bookings.map((b) => b.id)).toEqual([ids[0]!.toHexString()]);

    const byDriver = await repo.pageForCustomer(
      base({ limit: 50, search: 'nobody-by-address', driverIds: [driverId.toHexString()] }),
    );
    expect(byDriver.bookings.map((b) => b.id)).toEqual([ids[0]!.toHexString()]);
  });

  it('ranks by trip cost including waiting and the extra day', async () => {
    const page = await repo.pageForCustomer(base({ limit: 2, sort: 'AMOUNT_DESC' }));
    // 50k fare + 5k waiting + 100k extra day = 155k, above the 120k fare.
    expect(page.bookings.map((b) => b.id)).toEqual([extended.toHexString(), ids[2]!.toHexString()]);
    expect(page.nextCursor?.key).toBe(120_000);
  });

  it('totals every trip, and spend over completed ones net of credit', async () => {
    const summary = await repo.customerHistorySummary(customerId.toHexString());
    expect(summary.totalTrips).toBe(6);
    // 50k + (120k − 20k) + (50k + 5k + 100k)
    expect(summary.totalSpentPaise).toBe(305_000);
  });
});
