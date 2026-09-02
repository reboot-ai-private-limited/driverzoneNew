import mongoose from 'mongoose';
import type { Gender, OnboardingStatus, VehicleTypePreference } from '@driverzone/contracts';
import type {
  DriverProfile,
  DriverProfilePatch,
  DriverListFilter,
  PaginatedDrivers,
  DriverProfileRepositoryPort,
} from '../domain/driverProfile.repository.port.js';
import { DriverModel } from './driver.model.js';

interface RawDriver {
  _id: mongoose.Types.ObjectId;
  phone: string;
  fullName?: string | null;
  profilePicture?: string | null;
  dob?: Date | null;
  gender?: string | null;
  experienceYears?: number | null;
  alternatePhone?: string | null;
  emergencyContact?: { name?: string; phone?: string } | null;
  address?: string | null;
  vehicleTypePreference?: string | null;
  vehicleCategoryPreference?: string[];
  canDriveHill?: boolean;
  canDriveHillVerified?: boolean;
  onboardingStatus?: string;
  onboardingRejectionReason?: string | null;
  isVerified?: boolean;
  isOnDuty?: boolean;
}

function toDomain(doc: RawDriver): DriverProfile {
  const contact = doc.emergencyContact;
  return {
    id: String(doc._id),
    mobileNumber: doc.phone,
    fullName: doc.fullName ?? null,
    profilePicture: doc.profilePicture ?? null,
    dob: doc.dob ?? null,
    gender: (doc.gender as Gender | null) ?? null,
    experienceYears: doc.experienceYears ?? null,
    alternatePhone: doc.alternatePhone ?? null,
    emergencyContact:
      contact?.name !== undefined && contact.phone !== undefined
        ? { name: contact.name, phone: contact.phone }
        : null,
    address: doc.address ?? null,
    vehicleTypePreference: (doc.vehicleTypePreference as VehicleTypePreference | null) ?? null,
    vehicleCategoryPreference: doc.vehicleCategoryPreference ?? [],
    canDriveHill: doc.canDriveHill ?? false,
    canDriveHillVerified: doc.canDriveHillVerified ?? false,
    onboardingStatus: (doc.onboardingStatus as OnboardingStatus | undefined) ?? 'INCOMPLETE',
    onboardingRejectionReason: doc.onboardingRejectionReason ?? null,
    isVerified: doc.isVerified ?? false,
    isOnDuty: doc.isOnDuty ?? false,
  };
}

/** Absent leaves alone, explicit null clears — same reasoning as the customer repository. */
function toSet(patch: DriverProfilePatch): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (patch.fullName !== undefined) set['fullName'] = patch.fullName;
  if (patch.profilePicture !== undefined) set['profilePicture'] = patch.profilePicture;
  if (patch.dob !== undefined) set['dob'] = patch.dob;
  if (patch.gender !== undefined) set['gender'] = patch.gender;
  if (patch.experienceYears !== undefined) set['experienceYears'] = patch.experienceYears;
  if (patch.alternatePhone !== undefined) set['alternatePhone'] = patch.alternatePhone;
  if (patch.emergencyContact !== undefined) set['emergencyContact'] = patch.emergencyContact;
  if (patch.address !== undefined) set['address'] = patch.address;
  if (patch.vehicleTypePreference !== undefined) set['vehicleTypePreference'] = patch.vehicleTypePreference;
  if (patch.vehicleCategoryPreference !== undefined) {
    set['vehicleCategoryPreference'] = patch.vehicleCategoryPreference;
  }
  if (patch.canDriveHill !== undefined) set['canDriveHill'] = patch.canDriveHill;
  return set;
}

export class MongoDriverProfileRepository implements DriverProfileRepositoryPort {
  async findById(driverId: string): Promise<DriverProfile | undefined> {
    if (!mongoose.Types.ObjectId.isValid(driverId)) return undefined;
    const doc = await DriverModel.findById(driverId).lean().exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawDriver);
  }

  async findPaginated(filter: DriverListFilter, page: number, limit: number): Promise<PaginatedDrivers> {
    const query: mongoose.FilterQuery<any> = {};

    if (filter.onboardingStatus !== undefined) {
      query.onboardingStatus = filter.onboardingStatus;
    }
    if (filter.isVerified !== undefined) {
      query.isVerified = filter.isVerified;
    }
    if (filter.search !== undefined && filter.search.trim() !== '') {
      const searchRegex = new RegExp(filter.search.trim().replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
      query.$or = [
        { fullName: searchRegex },
        { phone: searchRegex }
      ];
    }

    const totalItems = await DriverModel.countDocuments(query).exec();
    const skip = (page - 1) * limit;

    const docs = await DriverModel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return {
      drivers: docs.map((doc) => toDomain(doc as unknown as RawDriver)),
      totalItems,
    };
  }

  async updateProfile(driverId: string, patch: DriverProfilePatch): Promise<DriverProfile | undefined> {
    if (!mongoose.Types.ObjectId.isValid(driverId)) return undefined;

    const set = toSet(patch);
    if (Object.keys(set).length === 0) return this.findById(driverId);

    const doc = await DriverModel.findByIdAndUpdate(driverId, { $set: set }, { new: true }).lean().exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawDriver);
  }

  async setOnboardingStatus(
    driverId: string,
    status: OnboardingStatus,
    rejectionReason: string | null,
  ): Promise<DriverProfile | undefined> {
    if (!mongoose.Types.ObjectId.isValid(driverId)) return undefined;

    const doc = await DriverModel.findByIdAndUpdate(
      driverId,
      {
        $set: {
          onboardingStatus: status,
          onboardingRejectionReason: rejectionReason,
          // Any status other than APPROVED means not verified. Stated explicitly rather than
          // left alone, so a rejection after an approval genuinely revokes duty eligibility
          // instead of leaving a rejected driver still dispatchable.
          ...(status === 'APPROVED' ? {} : { isVerified: false }),
        },
      },
      { new: true },
    )
      .lean()
      .exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawDriver);
  }

  /**
   * The approval write — ONE update setting all four fields together.
   *
   * `isVerified` is what dispatch and `POST /driver/duty` read; `onboardingStatus` is what the
   * driver's app renders. Splitting these across two calls is exactly how a driver ends up
   * showing "approved" while dispatch still refuses them (docs/LLD/database-schema.md).
   */
  async approve(driverId: string, adminId: string, at: Date): Promise<DriverProfile | undefined> {
    if (!mongoose.Types.ObjectId.isValid(driverId)) return undefined;

    const doc = await DriverModel.findByIdAndUpdate(
      driverId,
      {
        $set: {
          onboardingStatus: 'APPROVED',
          isVerified: true,
          onboardingRejectionReason: null,
          verifiedBy: new mongoose.Types.ObjectId(adminId),
          verifiedAt: at,
        },
      },
      { new: true },
    )
      .lean()
      .exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawDriver);
  }

  async recordLocation(
    driverId: string,
    fix: { lat: number; lng: number; recordedAt: Date },
  ): Promise<DriverProfile | undefined> {
    if (!mongoose.Types.ObjectId.isValid(driverId)) return undefined;

    const doc = await DriverModel.findByIdAndUpdate(
      driverId,
      {
        $set: {
          /*
           * GeoJSON order is [lng, lat] — the reverse of how humans and this codebase's own
           * `LatLngDto` write it. Getting it backwards does not throw; it silently places every
           * driver in the Arabian Sea and every wave finds nobody (docs/README.md §Conventions).
           */
          lastLocation: { type: 'Point', coordinates: [fix.lng, fix.lat] },
          lastLocationAt: fix.recordedAt,
        },
      },
      { new: true },
    )
      .lean()
      .exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawDriver);
  }

  async setDutyStatus(driverId: string, isOnDuty: boolean): Promise<DriverProfile | undefined> {
    if (!mongoose.Types.ObjectId.isValid(driverId)) return undefined;

    const doc = await DriverModel.findByIdAndUpdate(driverId, { $set: { isOnDuty } }, { new: true })
      .lean()
      .exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawDriver);
  }
}
