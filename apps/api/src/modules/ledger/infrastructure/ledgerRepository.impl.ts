import mongoose from 'mongoose';
import type { LedgerEntry, NewLedgerEntry } from '../domain/ledgerEntry.entity.js';
import type { LedgerRepositoryPort } from '../domain/ledgerRepository.port.js';
import { DriverEarningModel, type DriverEarningDoc } from './driverEarning.model.js';

function toEntity(doc: DriverEarningDoc): LedgerEntry {
  return {
    id: String(doc._id),
    driverId: String(doc.driverId),
    bookingId: doc.bookingId ? String(doc.bookingId) : null,
    entryType: doc.entryType as LedgerEntry['entryType'],
    amountPaise: doc.amountPaise,
    note: doc.note ?? null,
    payoutId: doc.payoutId ? String(doc.payoutId) : null,
    createdAt: doc.createdAt,
  };
}

/** Mongo's duplicate-key error, which is how the idempotency index reports a replay. */
const DUPLICATE_KEY = 11000;

export class MongoLedgerRepository implements LedgerRepositoryPort {
  /**
   * `ordered: false` so one duplicate does not abandon the rest of the batch.
   *
   * Completing a trip writes several entries at once, and a retry may find some already present
   * and some not — a crash between two inserts is exactly the case the idempotency index exists
   * for. With `ordered: true` the first duplicate stops the batch and the remaining entries are
   * silently lost. Unordered, Mongo attempts all of them and reports the duplicates, which we
   * then treat as "already written" rather than as a failure.
   */
  async append(entries: readonly NewLedgerEntry[]): Promise<LedgerEntry[]> {
    if (entries.length === 0) return [];

    const docs = entries.map((entry) => ({
      driverId: new mongoose.Types.ObjectId(entry.driverId),
      bookingId: entry.bookingId ? new mongoose.Types.ObjectId(entry.bookingId) : null,
      entryType: entry.entryType,
      amountPaise: entry.amountPaise,
      note: entry.note ?? null,
    }));

    try {
      const written = await DriverEarningModel.insertMany(docs, { ordered: false });
      return written.map((doc) => toEntity(doc.toObject() as DriverEarningDoc));
    } catch (error) {
      const result = asPartialInsertResult(error);
      if (result === null) throw error;
      return result;
    }
  }

  async sumForDriver(driverId: string): Promise<number> {
    if (!mongoose.isValidObjectId(driverId)) return 0;

    const [row] = await DriverEarningModel.aggregate<{ total: number }>([
      { $match: { driverId: new mongoose.Types.ObjectId(driverId) } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);

    return row?.total ?? 0;
  }

  async listForDriver(driverId: string, limit: number): Promise<LedgerEntry[]> {
    if (!mongoose.isValidObjectId(driverId)) return [];
    const docs = await DriverEarningModel.find({ driverId }).sort({ createdAt: -1 }).limit(limit);
    return docs.map((doc) => toEntity(doc.toObject() as DriverEarningDoc));
  }

  async listForBooking(bookingId: string): Promise<LedgerEntry[]> {
    if (!mongoose.isValidObjectId(bookingId)) return [];
    const docs = await DriverEarningModel.find({ bookingId }).sort({ createdAt: 1 });
    return docs.map((doc) => toEntity(doc.toObject() as DriverEarningDoc));
  }
}

/**
 * Reads a bulk-write failure that was ENTIRELY duplicate keys, returning whatever did get
 * written. Any other error — a connection drop, a validation failure — returns `null` and is
 * rethrown by the caller, because "some rows were rejected for a reason we did not check" must
 * never be reported to a completion handler as success.
 */
function asPartialInsertResult(error: unknown): LedgerEntry[] | null {
  if (typeof error !== 'object' || error === null) return null;

  const bulk = error as {
    code?: number;
    writeErrors?: Array<{ err?: { code?: number }; code?: number }>;
    insertedDocs?: DriverEarningDoc[];
  };

  const writeErrors = bulk.writeErrors ?? [];
  const everyErrorIsADuplicate =
    writeErrors.length > 0 &&
    writeErrors.every((e) => (e.err?.code ?? e.code) === DUPLICATE_KEY);

  if (!everyErrorIsADuplicate && bulk.code !== DUPLICATE_KEY) return null;

  return (bulk.insertedDocs ?? []).map(toEntity);
}
