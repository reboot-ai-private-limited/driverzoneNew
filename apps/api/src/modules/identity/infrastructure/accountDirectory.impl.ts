import type { Role } from '@driverzone/contracts';
import { AdminUserModel } from './adminUser.model.js';
import { CustomerModel } from './customer.model.js';
import { DriverModel } from './driver.model.js';

/**
 * INFRASTRUCTURE — the read-side and rating-cache halves of `identity.public.ts`, over the same
 * three collections `account.repository.impl.ts` covers.
 *
 * Separate from that file because it backs a CROSS-MODULE contract rather than the auth port: the
 * consumers are other modules, not this one's use cases, and nothing here participates in the
 * login flow. The role branching is duplicated for the TypeScript reason that file documents — a
 * union of two Mongoose `Model<T>` types has irreconcilable call signatures, so the alternative
 * is a cast rather than shared code.
 */
export class MongoAccountDirectory {
  /**
   * Batched, never per-id. The admin review ledger renders a reviewer and a reviewee name on
   * every row; called inside a `.map()` this would be two queries per row.
   *
   * A missing id maps to `null` rather than being absent — a deleted account should render as
   * unnamed, not silently drop the row that referenced it.
   */
  async namesByIds(role: Role, ids: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (ids.length === 0) return out;

    const unique = [...new Set(ids)];

    const docs =
      role === 'ADMIN'
        ? await AdminUserModel.find({ _id: { $in: unique } })
            .select('fullName phone')
            .lean()
            .exec()
        : role === 'CUSTOMER'
          ? await CustomerModel.find({ _id: { $in: unique } })
              .select('fullName phone')
              .lean()
              .exec()
          : await DriverModel.find({ _id: { $in: unique } })
              .select('fullName phone')
              .lean()
              .exec();

    for (const doc of docs) {
      // Falls back to the phone number: an account that has not completed its profile still has
      // to be identifiable to whoever is looking at the row.
      out.set(String(doc._id), doc.fullName ?? doc.phone ?? null);
    }
    return out;
  }

  /** Stores an average `reviews` computed. See `RatingCacheContract` for why it does not read. */
  async setRating(role: Role, id: string, average: number, count: number): Promise<void> {
    if (role === 'ADMIN') return;

    if (role === 'CUSTOMER') {
      await CustomerModel.updateOne({ _id: id }, { $set: { rating: average, ratingCount: count } })
        .exec();
      return;
    }
    await DriverModel.updateOne({ _id: id }, { $set: { rating: average, ratingCount: count } })
      .exec();
  }
}
