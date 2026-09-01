import mongoose from 'mongoose';
import type { BookingStatus } from '@driverzone/contracts';
import type { GeoPoint } from '../domain/booking.entity.js';
import type {
  CancellationCharge,
  ChargeRepositoryPort,
  FareAdjustment,
} from '../domain/chargeRepository.port.js';
import {
  CancellationChargeModel,
  FareAdjustmentModel,
  PickupPinReportModel,
  type CancellationChargeDoc,
  type FareAdjustmentDoc,
} from './charge.model.js';

function toAdjustment(doc: FareAdjustmentDoc): FareAdjustment {
  return {
    id: String(doc._id),
    bookingId: String(doc.bookingId),
    type: doc.type as FareAdjustment['type'],
    amountPaise: doc.amountPaise,
    label: doc.label,
    settledByPaymentId: doc.settledByPaymentId ? String(doc.settledByPaymentId) : null,
  };
}

function toCancellationCharge(doc: CancellationChargeDoc): CancellationCharge {
  return {
    id: String(doc._id),
    bookingId: String(doc.bookingId),
    customerId: String(doc.customerId),
    chargedTo: doc.chargedTo as CancellationCharge['chargedTo'],
    amountPaise: doc.amountPaise,
    atStatus: doc.atStatus as BookingStatus,
    reason: doc.reason,
    settledByPaymentId: doc.settledByPaymentId ? String(doc.settledByPaymentId) : null,
  };
}

export class MongoChargeRepository implements ChargeRepositoryPort {
  /**
   * `upsert` with `$setOnInsert`, so a retry finds the original rather than overwriting it.
   *
   * Overwriting would be worse than it looks: a completion retried after the waiting clock had
   * been recomputed from a different `startedAt` would silently change what the customer owes.
   */
  async recordAdjustment(input: {
    bookingId: string;
    type: FareAdjustment['type'];
    amountPaise: number;
    label: string;
  }): Promise<FareAdjustment> {
    const doc = await FareAdjustmentModel.findOneAndUpdate(
      { bookingId: new mongoose.Types.ObjectId(input.bookingId), type: input.type },
      { $setOnInsert: { amountPaise: input.amountPaise, label: input.label } },
      { new: true, upsert: true },
    );

    return toAdjustment(doc.toObject() as FareAdjustmentDoc);
  }

  async markAdjustmentsSettled(bookingId: string, paymentId: string): Promise<void> {
    await FareAdjustmentModel.updateMany(
      { bookingId: new mongoose.Types.ObjectId(bookingId), settledByPaymentId: null },
      { $set: { settledByPaymentId: new mongoose.Types.ObjectId(paymentId) } },
    );
  }

  async listAdjustments(bookingId: string): Promise<FareAdjustment[]> {
    if (!mongoose.isValidObjectId(bookingId)) return [];
    const docs = await FareAdjustmentModel.find({ bookingId }).sort({ createdAt: 1 });
    return docs.map((doc) => toAdjustment(doc.toObject() as FareAdjustmentDoc));
  }

  async recordCancellationCharge(input: {
    bookingId: string;
    customerId: string;
    chargedTo: CancellationCharge['chargedTo'];
    amountPaise: number;
    atStatus: BookingStatus;
    reason: string;
    settledByPaymentId?: string | undefined;
  }): Promise<CancellationCharge> {
    const doc = await CancellationChargeModel.findOneAndUpdate(
      { bookingId: new mongoose.Types.ObjectId(input.bookingId) },
      {
        $setOnInsert: {
          customerId: new mongoose.Types.ObjectId(input.customerId),
          chargedTo: input.chargedTo,
          amountPaise: input.amountPaise,
          atStatus: input.atStatus,
          reason: input.reason,
          settledByPaymentId:
            input.settledByPaymentId === undefined
              ? null
              : new mongoose.Types.ObjectId(input.settledByPaymentId),
        },
      },
      { new: true, upsert: true },
    );

    return toCancellationCharge(doc.toObject() as CancellationChargeDoc);
  }

  /**
   * `chargedTo: 'CUSTOMER'` in the match, because a driver's penalty is a ledger debit against
   * their earnings and is never a customer's debt.
   */
  async outstandingDues(customerId: string): Promise<number> {
    if (!mongoose.isValidObjectId(customerId)) return 0;

    const [row] = await CancellationChargeModel.aggregate<{ total: number }>([
      {
        $match: {
          customerId: new mongoose.Types.ObjectId(customerId),
          chargedTo: 'CUSTOMER',
          settledByPaymentId: null,
        },
      },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);

    return row?.total ?? 0;
  }

  async settleDues(customerId: string, paymentId: string): Promise<void> {
    if (!mongoose.isValidObjectId(customerId)) return;

    await CancellationChargeModel.updateMany(
      {
        customerId: new mongoose.Types.ObjectId(customerId),
        chargedTo: 'CUSTOMER',
        settledByPaymentId: null,
      },
      { $set: { settledByPaymentId: new mongoose.Types.ObjectId(paymentId) } },
    );
  }

  async findCancellationCharge(bookingId: string): Promise<CancellationCharge | null> {
    if (!mongoose.isValidObjectId(bookingId)) return null;
    const doc = await CancellationChargeModel.findOne({ bookingId });
    return doc === null ? null : toCancellationCharge(doc.toObject() as CancellationChargeDoc);
  }

  async recordPinReport(input: {
    bookingId: string;
    driverId: string;
    driverLocation: GeoPoint;
    pickupLocation: GeoPoint;
    distanceMetres: number;
    note?: string | undefined;
  }): Promise<void> {
    await PickupPinReportModel.create({
      bookingId: new mongoose.Types.ObjectId(input.bookingId),
      driverId: new mongoose.Types.ObjectId(input.driverId),
      driverLocation: input.driverLocation,
      pickupLocation: input.pickupLocation,
      distanceMetres: input.distanceMetres,
      note: input.note ?? null,
    });
  }
}
