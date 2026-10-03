import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../../src/shared/db/mongo.js';
import { loadEnv } from '../../src/config/env.js';
import { MongoBookingRepository } from '../../src/modules/bookings/infrastructure/bookingRepository.impl.js';
import {
  BookingEventModel,
  BookingModel,
} from '../../src/modules/bookings/infrastructure/booking.model.js';

/**
 * The driver's payment override against a real Mongo: the switch to cash and its event row are one
 * transaction, and the filter refuses another driver's trip and an already-paid one.
 *
 * SCOPED TO THROWAWAY BOOKINGS. Runs against the dev database; deletes only what it inserted.
 */
describe('Payment override', () => {
  const repo = new MongoBookingRepository();
  const driverId = new mongoose.Types.ObjectId();
  const ids: mongoose.Types.ObjectId[] = [];

  function row(over: Record<string, unknown>) {
    const _id = new mongoose.Types.ObjectId();
    ids.push(_id);
    const at = new Date('2026-10-02T09:00:00Z');
    return {
      _id,
      reference: `T-${_id.toHexString().slice(-8)}`,
      customerId: new mongoose.Types.ObjectId(),
      quoteId: new mongoose.Types.ObjectId(),
      driverId,
      status: 'STARTED',
      paymentMode: null,
      paymentStatus: 'NOT_SELECTED',
      serviceType: 'HOURLY',
      pickup: { lat: 22.5, lng: 88.3 },
      pickupAddress: 'Park Street',
      drop: { lat: 22.6, lng: 88.4 },
      dropAddress: 'Salt Lake',
      fareSnapshot: { fare: { totalPaise: 50_000 } },
      walletCreditPaise: 0,
      walletDebtPaise: 0,
      isScheduled: false,
      scheduledAt: at,
      dispatchAt: at,
      startOtp: '4821',
      otpAttempts: 0,
      createdAt: at,
      updatedAt: at,
      ...over,
    };
  }

  const override = (bookingId: mongoose.Types.ObjectId, by = driverId) =>
    repo.overridePaymentToCash({
      bookingId: bookingId.toHexString(),
      driverId: by.toHexString(),
      reason: 'WEB_BOOKING',
      metadata: { previousPaymentMode: null },
    });

  beforeAll(async () => {
    loadEnv();
    await connectMongo();
    await BookingModel.collection.insertMany([
      row({}),
      row({ paymentMode: 'UPI', paymentStatus: 'PAID' }),
      row({ status: 'ARRIVED' }),
    ]);
  });

  afterAll(async () => {
    await BookingEventModel.collection.deleteMany({ bookingId: { $in: ids } });
    await BookingModel.collection.deleteMany({ _id: { $in: ids } });
    await disconnectMongo();
  });

  it('switches to cash and writes the event with the driver and reason', async () => {
    const updated = await override(ids[0]!);

    expect(updated).toEqual(expect.objectContaining({ paymentMode: 'CASH', paymentStatus: 'CASH' }));
    const events = await repo.listEvents(ids[0]!.toHexString());
    expect(events).toEqual([
      expect.objectContaining({
        fromStatus: 'STARTED',
        toStatus: 'STARTED',
        actorType: 'DRIVER',
        actorId: driverId.toHexString(),
        reason: 'WEB_BOOKING',
        metadata: expect.objectContaining({ paymentOverride: true }),
      }),
    ]);
  });

  it('writes nothing for another driver, a paid trip, or a trip not under way', async () => {
    expect(await override(ids[0]!, new mongoose.Types.ObjectId())).toBeNull();
    expect(await override(ids[1]!)).toBeNull();
    expect(await override(ids[2]!)).toBeNull();

    expect(await repo.listEvents(ids[1]!.toHexString())).toEqual([]);
    expect(await repo.listEvents(ids[2]!.toHexString())).toEqual([]);
    expect((await BookingModel.findById(ids[1]).lean())?.paymentStatus).toBe('PAID');
  });
});
