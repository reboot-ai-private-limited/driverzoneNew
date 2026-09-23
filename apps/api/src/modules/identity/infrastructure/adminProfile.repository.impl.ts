import mongoose from 'mongoose';
import type { AdminRole } from '@driverzone/contracts';
import type {
  AdminProfile,
  AdminProfileRepositoryPort,
} from '../domain/adminProfile.repository.port.js';
import { AdminUserModel } from './adminUser.model.js';

interface RawAdmin {
  _id: mongoose.Types.ObjectId;
  phone: string;
  fullName: string;
  adminRole?: AdminRole | null;
}

/**
 * What a row without `adminRole` is. Every admin before roles existed could do everything, so
 * reading them as anything less would silently demote the people who run the system today — and
 * could leave nobody able to open the admin roster at all.
 */
export const LEGACY_ADMIN_ROLE: AdminRole = 'SUPER_ADMIN';

export function roleOf(doc: { adminRole?: AdminRole | null }): AdminRole {
  return doc.adminRole ?? LEGACY_ADMIN_ROLE;
}

function toDomain(doc: RawAdmin): AdminProfile {
  return {
    id: String(doc._id),
    mobileNumber: doc.phone,
    fullName: doc.fullName,
    adminRole: roleOf(doc),
  };
}

/**
 * INFRASTRUCTURE — an admin's own profile.
 *
 * Read and rename only. Managing OTHER admins is `MongoAdminRosterRepository`.
 */
export class MongoAdminProfileRepository implements AdminProfileRepositoryPort {
  async findById(adminId: string): Promise<AdminProfile | undefined> {
    if (!mongoose.Types.ObjectId.isValid(adminId)) return undefined;
    // isActive filtered here too: a deactivated admin holding a still-valid access token must
    // not keep working until it expires.
    const doc = await AdminUserModel.findOne({ _id: adminId, isActive: true }).lean().exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawAdmin);
  }

  async updateProfile(
    adminId: string,
    patch: { fullName?: string },
  ): Promise<AdminProfile | undefined> {
    if (!mongoose.Types.ObjectId.isValid(adminId)) return undefined;
    if (patch.fullName === undefined) return this.findById(adminId);

    const doc = await AdminUserModel.findOneAndUpdate(
      { _id: adminId, isActive: true },
      { $set: { fullName: patch.fullName } },
      { new: true },
    )
      .lean()
      .exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawAdmin);
  }
}
