import mongoose from 'mongoose';
import type {
  PayoutRepositoryPort,
  PayoutListFilter,
} from '../domain/payoutRepository.port.js';
import type { Payout, NewPayout } from '../domain/payout.entity.js';
import { PayoutModel, type PayoutDoc } from './payout.model.js';

function toDomain(doc: PayoutDoc): Payout {
  return {
    id: doc._id.toHexString(),
    driverId: doc.driverId.toHexString(),
    amountPaise: doc.amountPaise,
    status: doc.status,
    utr: doc.utr ?? null,
    notes: doc.notes ?? null,
    createdAt: doc.createdAt,
    processedAt: doc.processedAt ?? null,
  };
}

export class MongoPayoutRepository implements PayoutRepositoryPort {
  async create(payout: NewPayout): Promise<Payout> {
    const doc = await PayoutModel.create({
      driverId: new mongoose.Types.ObjectId(payout.driverId),
      amountPaise: payout.amountPaise,
      status: payout.status ?? 'PAID',
      utr: payout.utr ?? null,
      notes: payout.notes ?? null,
      processedAt: payout.processedAt ?? (payout.status === 'PAID' ? new Date() : null),
    });

    return toDomain(doc);
  }

  async findById(id: string): Promise<Payout | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null;
    }
    const doc = await PayoutModel.findById(id).lean<PayoutDoc | null>().exec();
    return doc ? toDomain(doc) : null;
  }

  async listPaginated(
    filter: PayoutListFilter,
    page: number,
    limit: number,
  ): Promise<{ payouts: Payout[]; totalItems: number }> {
    const query: mongoose.FilterQuery<PayoutDoc> = {};

    if (filter.driverId) {
      if (mongoose.Types.ObjectId.isValid(filter.driverId)) {
        query.driverId = new mongoose.Types.ObjectId(filter.driverId);
      } else {
        // If invalid ObjectId string, will match nothing
        return { payouts: [], totalItems: 0 };
      }
    }

    if (filter.status) {
      query.status = filter.status;
    }

    if (filter.fromDate || filter.toDate) {
      const createdAtQuery: { $gte?: Date; $lte?: Date } = {};
      if (filter.fromDate) createdAtQuery.$gte = filter.fromDate;
      if (filter.toDate) createdAtQuery.$lte = filter.toDate;
      query.createdAt = createdAtQuery;
    }

    const skip = (page - 1) * limit;

    const [docs, totalItems] = await Promise.all([
      PayoutModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<PayoutDoc[]>()
        .exec(),
      PayoutModel.countDocuments(query).exec(),
    ]);

    return {
      payouts: docs.map(toDomain),
      totalItems,
    };
  }
}
