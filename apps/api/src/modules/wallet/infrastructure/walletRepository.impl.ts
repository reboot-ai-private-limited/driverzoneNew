import mongoose from 'mongoose';
import type { NewWalletEntry, WalletEntry } from '../domain/walletEntry.entity.js';
import type { WalletRepositoryPort } from '../domain/walletRepository.port.js';
import { WalletEntryModel, type WalletEntryDoc } from './walletEntry.model.js';

function toEntity(doc: WalletEntryDoc): WalletEntry {
  return {
    id: String(doc._id),
    customerId: String(doc.customerId),
    bookingId: doc.bookingId ? String(doc.bookingId) : null,
    entryType: doc.entryType as WalletEntry['entryType'],
    amountPaise: doc.amountPaise,
    note: doc.note ?? null,
    createdAt: doc.createdAt,
  };
}

/** Mongo's duplicate-key error, which is how the idempotency index reports a replay. */
const DUPLICATE_KEY = 11000;

export class MongoWalletRepository implements WalletRepositoryPort {
  /**
   * `ordered: false` so one duplicate does not abandon the rest of the batch.
   *
   * A booking can write two rows at once — spending credit and clearing a debt never happen
   * together, but a cancellation writes a fee while a retry may find it already there. Ordered,
   * the first duplicate stops the batch and the remaining entries are silently lost. Unordered,
   * Mongo attempts all of them and reports the duplicates, which are then read as "already
   * written" rather than as a failure.
   */
  async append(entries: readonly NewWalletEntry[]): Promise<WalletEntry[]> {
    if (entries.length === 0) return [];

    const docs = entries.map((entry) => ({
      customerId: new mongoose.Types.ObjectId(entry.customerId),
      bookingId: entry.bookingId ? new mongoose.Types.ObjectId(entry.bookingId) : null,
      entryType: entry.entryType,
      amountPaise: entry.amountPaise,
      note: entry.note ?? null,
    }));

    try {
      const written = await WalletEntryModel.insertMany(docs, { ordered: false });
      return written.map((doc) => toEntity(doc.toObject() as WalletEntryDoc));
    } catch (error) {
      const result = asPartialInsertResult(error);
      if (result === null) throw error;
      return result;
    }
  }

  async sumForCustomer(customerId: string): Promise<number> {
    if (!mongoose.isValidObjectId(customerId)) return 0;

    const [row] = await WalletEntryModel.aggregate<{ total: number }>([
      { $match: { customerId: new mongoose.Types.ObjectId(customerId) } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);

    return row?.total ?? 0;
  }

  async listForCustomer(customerId: string, limit: number): Promise<WalletEntry[]> {
    if (!mongoose.isValidObjectId(customerId)) return [];

    const docs = await WalletEntryModel.find({
      customerId: new mongoose.Types.ObjectId(customerId),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return docs.map((doc) => toEntity(doc as WalletEntryDoc));
  }

  async listForBooking(bookingId: string): Promise<WalletEntry[]> {
    if (!mongoose.isValidObjectId(bookingId)) return [];

    const docs = await WalletEntryModel.find({
      bookingId: new mongoose.Types.ObjectId(bookingId),
    })
      .sort({ createdAt: 1 })
      .lean();

    return docs.map((doc) => toEntity(doc as WalletEntryDoc));
  }
}

/**
 * Reads a bulk-insert failure that is ENTIRELY duplicates as a successful replay.
 *
 * Anything else — a validation failure, a lost connection — is rethrown, because "some rows did
 * not write" is only safe to ignore when the reason is that they were already there.
 */
function asPartialInsertResult(error: unknown): WalletEntry[] | null {
  if (typeof error !== 'object' || error === null) return null;

  const bulk = error as {
    code?: number;
    writeErrors?: Array<{ err?: { code?: number }; code?: number }>;
    insertedDocs?: WalletEntryDoc[];
  };

  const writeErrors = bulk.writeErrors ?? [];
  const everyErrorIsADuplicate =
    writeErrors.length > 0 && writeErrors.every((e) => (e.err?.code ?? e.code) === DUPLICATE_KEY);

  if (!everyErrorIsADuplicate && bulk.code !== DUPLICATE_KEY) return null;

  return (bulk.insertedDocs ?? []).map(toEntity);
}
