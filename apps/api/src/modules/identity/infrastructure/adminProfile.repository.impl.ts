import mongoose from 'mongoose';
import type {
  AdminProfile,
  AdminProfileRepositoryPort,
} from '../domain/adminProfile.repository.port.js';
import { AdminUserModel } from './adminUser.model.js';

interface RawAdmin {
  _id: mongoose.Types.ObjectId;
  phone: string;
  fullName: string;
}

function toDomain(doc: RawAdmin): AdminProfile {
  return { id: String(doc._id), mobileNumber: doc.phone, fullName: doc.fullName };
}

/**
 * INFRASTRUCTURE — admin profiles.
 *
 * Read and rename only. No create, no delete: admin records are provisioned out of band, which
 * is the safeguard that replaced the second auth factor (docs/decision-log.md, 2026-08-24).
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
