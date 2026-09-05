import type { Role } from '@driverzone/contracts';
import type { StoragePort } from '@/shared/storage/storage.port.js';
import type { CustomerContact, DriverCard } from '../identity.public.js';
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
  /** Only for turning an avatar's storage key into a URL — see `driverCardsByIds`. */
  constructor(private readonly storage: StoragePort) {}

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

  /**
   * Accounts whose name or mobile number matches `search`. See the contract for why this returns
   * ids rather than rows.
   *
   * The term is ESCAPED before it becomes a regex. A search box is user input and `.*` or a
   * nested quantifier reaching a regex engine is a denial of service, not a clever search — the
   * admin who pastes a phone number with a `+` in it would otherwise get an error or, worse, a
   * pattern that means something else entirely.
   *
   * Anchored `^` on neither field: an admin searching "9001" means the number contains it, and
   * "rahul" should find "Rahul Sharma" wherever the word sits. That is a collection scan, which
   * is why `limit` exists and why the caller passes a real one.
   */
  async idsMatching(role: Role, search: string, limit: number): Promise<string[]> {
    const term = search.trim();
    if (term === '') return [];

    // `$&` is the whole match — every regex metacharacter is prefixed with a backslash.
    const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const filter = { $or: [{ fullName: pattern }, { phone: pattern }] };

    const docs =
      role === 'ADMIN'
        ? await AdminUserModel.find(filter).select('_id').limit(limit).lean().exec()
        : role === 'CUSTOMER'
          ? await CustomerModel.find(filter).select('_id').limit(limit).lean().exec()
          : await DriverModel.find(filter).select('_id').limit(limit).lean().exec();

    return docs.map((doc) => String(doc._id));
  }

  /**
   * The driver card a customer sees — name, photo, rating, and the phone number.
   *
   * `getPublicUrl`, NOT a presigned download. An avatar is uploaded to the public bucket
   * (`isPrivate: false`) exactly so this URL can be long-lived: the customer's trip screen may sit
   * open for an hour and a link that expires in minutes would leave them looking at a broken
   * image halfway through the ride. Documents are the opposite and are presigned per read.
   *
   * `rating` is nulled when nobody has rated the driver. The column defaults to 5.0, so passing it
   * through unconditionally would put an unearned five stars on every new driver's card — and the
   * customer app would have no way to tell that from a genuinely excellent one.
   */
  async driverCardsByIds(ids: string[]): Promise<Map<string, DriverCard>> {
    const out = new Map<string, DriverCard>();
    if (ids.length === 0) return out;

    const docs = await DriverModel.find({ _id: { $in: [...new Set(ids)] } })
      .select('fullName phone profilePicture rating ratingCount')
      .lean()
      .exec();

    for (const doc of docs) {
      const id = String(doc._id);
      out.set(id, {
        id,
        fullName: doc.fullName ?? null,
        phone: doc.phone ?? null,
        photoUrl:
          doc.profilePicture === null || doc.profilePicture === undefined
            ? null
            : this.storage.getPublicUrl(doc.profilePicture),
        rating: (doc.ratingCount ?? 0) > 0 ? (doc.rating ?? null) : null,
        ratingCount: doc.ratingCount ?? 0,
      });
    }

    return out;
  }

  /**
   * The customer contact the driver on their trip sees — name and phone number.
   *
   * The mirror of `driverCardsByIds`. `bookings` gates the phone on the trip still being live
   * before it reaches the driver app — see `PHONE_VISIBLE_STATUSES` in `bookings.mapper.ts`.
   */
  async customerContactsByIds(ids: string[]): Promise<Map<string, CustomerContact>> {
    const out = new Map<string, CustomerContact>();
    if (ids.length === 0) return out;

    const docs = await CustomerModel.find({ _id: { $in: [...new Set(ids)] } })
      .select('fullName phone')
      .lean()
      .exec();

    for (const doc of docs) {
      const id = String(doc._id);
      out.set(id, { id, fullName: doc.fullName ?? null, phone: doc.phone ?? null });
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
