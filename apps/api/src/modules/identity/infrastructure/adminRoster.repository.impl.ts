import mongoose from 'mongoose';
import type {
  AdminRosterEntry,
  AdminRosterRepositoryPort,
  GuardedAdminChange,
} from '../domain/adminRoster.repository.port.js';
import { adminPhoneTaken, lastSuperAdmin } from '../domain/identity.errors.js';
import { AdminUserModel, type AdminUserDoc } from './adminUser.model.js';
import { roleOf } from './adminProfile.repository.impl.js';

/**
 * "An active super admin", as a filter. `null` matches a MISSING `adminRole` too, which is every
 * row written before roles existed — `LEGACY_ADMIN_ROLE` reads those as super admins, and this
 * must count them the same way or the guard below would refuse to demote anyone on day one.
 */
const ACTIVE_SUPER_ADMIN = { isActive: true, adminRole: { $in: ['SUPER_ADMIN', null] } };

function toEntry(doc: AdminUserDoc): AdminRosterEntry {
  return {
    id: String(doc._id),
    mobileNumber: doc.phone,
    fullName: doc.fullName,
    adminRole: roleOf(doc),
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    deactivatedAt: doc.deactivatedAt ?? null,
  };
}

/** Mongo's duplicate-key error — the unique `phone` index losing a race to another insert. */
function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/**
 * INFRASTRUCTURE — the admin roster, as a SUPER_ADMIN manages it.
 *
 * Needs the replica set that `docker-compose` already runs Mongo as, for `changeGuarded`'s
 * transaction — the same requirement the booking→ledger write already has.
 */
export class MongoAdminRosterRepository implements AdminRosterRepositoryPort {
  async list(): Promise<AdminRosterEntry[]> {
    // Active first, then newest — the people who can sign in now are what the page is for.
    const docs = await AdminUserModel.find().sort({ isActive: -1, createdAt: -1 }).lean().exec();
    return docs.map((doc) => toEntry(doc as AdminUserDoc));
  }

  async findById(adminId: string): Promise<AdminRosterEntry | undefined> {
    if (!mongoose.isValidObjectId(adminId)) return undefined;
    const doc = await AdminUserModel.findById(adminId).lean().exec();
    return doc === null ? undefined : toEntry(doc as AdminUserDoc);
  }

  async findByPhone(phone: string): Promise<AdminRosterEntry | undefined> {
    const doc = await AdminUserModel.findOne({ phone }).lean().exec();
    return doc === null ? undefined : toEntry(doc as AdminUserDoc);
  }

  async create(input: {
    phone: string;
    fullName: string;
    adminRole: AdminRosterEntry['adminRole'];
    createdBy: string;
  }): Promise<AdminRosterEntry> {
    try {
      const created = await AdminUserModel.create({
        phone: input.phone,
        fullName: input.fullName,
        // Always written explicitly, so a new row never falls back to the legacy reading.
        adminRole: input.adminRole,
        createdBy: input.createdBy,
        isActive: true,
      });
      return toEntry(created.toObject() as AdminUserDoc);
    } catch (err) {
      // The use case checks first; this is the race where two super admins add one number at once.
      if (isDuplicateKey(err)) throw adminPhoneTaken();
      throw err;
    }
  }

  async changeGuarded(
    adminId: string,
    change: GuardedAdminChange,
  ): Promise<AdminRosterEntry | undefined> {
    if (!mongoose.isValidObjectId(adminId)) return undefined;

    const set: Record<string, unknown> = {};
    if (change.fullName !== undefined) set['fullName'] = change.fullName;
    if (change.adminRole !== undefined) set['adminRole'] = change.adminRole;
    if (change.isActive === false) {
      set['isActive'] = false;
      set['deactivatedAt'] = new Date();
      set['deactivatedBy'] = change.byAdminId;
    }
    if (change.isActive === true) {
      set['isActive'] = true;
      set['deactivatedAt'] = null;
      set['deactivatedBy'] = null;
    }

    const session = await mongoose.startSession();
    try {
      let result: AdminRosterEntry | undefined;

      // `withTransaction` retries on a write conflict, which is how a losing concurrent demotion
      // gets re-run against the winner's result — and then refused by the count below.
      await session.withTransaction(async () => {
        const updated = await AdminUserModel.findOneAndUpdate(
          { _id: adminId },
          { $set: set },
          { new: true, session },
        )
          .lean()
          .exec();

        if (updated === null) {
          result = undefined;
          return;
        }

        /*
         * Touch every remaining active super admin. Two transactions demoting DIFFERENT super
         * admins would otherwise each count the other as still there and both commit — write skew,
         * which snapshot isolation does not prevent. Both writing the same documents turns that
         * into a write conflict, and Mongo aborts one of them.
         */
        const touched = await AdminUserModel.updateMany(
          ACTIVE_SUPER_ADMIN,
          { $inc: { rosterVersion: 1 } },
          { session },
        ).exec();

        if (touched.matchedCount === 0) throw lastSuperAdmin();

        result = toEntry(updated as AdminUserDoc);
      });

      return result;
    } finally {
      await session.endSession();
    }
  }
}
