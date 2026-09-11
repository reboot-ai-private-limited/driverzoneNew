import mongoose from 'mongoose';
import type { FavouriteDriver } from '../domain/favourite.entity.js';
import type { FavouriteRepositoryPort } from '../domain/favouriteRepository.port.js';
import { FavouriteDriverModel } from './favouriteDriver.model.js';

/** Mongo's duplicate-key error. The unique pair index is what raises it. */
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

export class MongoFavouriteRepository implements FavouriteRepositoryPort {
  /**
   * INSERT AND CATCH, not read-then-write.
   *
   * Checking for an existing row first and inserting if there is none is a race: two taps of the
   * heart a few milliseconds apart both read "not there". The unique index already decides the
   * question atomically, so the duplicate error IS the answer — `added: false` — and not a
   * failure to report. Every other error is still thrown.
   */
  async add(customerId: string, driverId: string): Promise<{ added: boolean }> {
    try {
      await FavouriteDriverModel.create({
        customerId: new mongoose.Types.ObjectId(customerId),
        driverId: new mongoose.Types.ObjectId(driverId),
      });
      return { added: true };
    } catch (error) {
      if (isDuplicateKeyError(error)) return { added: false };
      throw error;
    }
  }

  async remove(customerId: string, driverId: string): Promise<void> {
    if (!mongoose.isValidObjectId(customerId) || !mongoose.isValidObjectId(driverId)) return;
    await FavouriteDriverModel.deleteOne({ customerId, driverId });
  }

  async listForCustomer(customerId: string): Promise<FavouriteDriver[]> {
    if (!mongoose.isValidObjectId(customerId)) return [];

    const docs = await FavouriteDriverModel.find({ customerId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return docs.map((doc) => ({
      customerId: String(doc.customerId),
      driverId: String(doc.driverId),
      createdAt: doc.createdAt,
    }));
  }

  async countForCustomer(customerId: string): Promise<number> {
    if (!mongoose.isValidObjectId(customerId)) return 0;
    return FavouriteDriverModel.countDocuments({ customerId });
  }
}
