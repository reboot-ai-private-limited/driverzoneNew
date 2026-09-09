import mongoose from 'mongoose';
import type {
  CarCategory,
  Gender,
  OnboardingStatus,
  VehicleTypePreference,
} from '@driverzone/contracts';
import type {
  DriverProfile,
  DriverProfilePatch,
  DriverListFilter,
  PaginatedDrivers,
  DriverProfileRepositoryPort,
  LiveDriverRecord,
  LiveDriverFilter,
} from '../domain/driverProfile.repository.port.js';
import { DriverModel, type DriverDoc } from './driver.model.js';

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
  vehicleTypePreferences?: string[];
  vehicleCategoryPreference?: string[];
  canDriveHill?: boolean;
  canDriveHillVerified?: boolean;
  onboardingStatus?: string;
  onboardingRejectionReason?: string | null;
  isVerified?: boolean;
  isOnDuty?: boolean;
  isBlocked?: boolean;
  blockedReason?: string | null;
  rating?: number;
  ratingCount?: number;
  totalTrips?: number;
  lastRideAt?: Date | null;
  createdAt?: Date;
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
    vehicleTypePreferences: (doc.vehicleTypePreferences as VehicleTypePreference[] | undefined) ?? [],
    vehicleCategoryPreference: (doc.vehicleCategoryPreference as CarCategory[] | undefined) ?? [],
    canDriveHill: doc.canDriveHill ?? false,
    canDriveHillVerified: doc.canDriveHillVerified ?? false,
    onboardingStatus: (doc.onboardingStatus as OnboardingStatus | undefined) ?? 'INCOMPLETE',
    onboardingRejectionReason: doc.onboardingRejectionReason ?? null,
    isVerified: doc.isVerified ?? false,
    isOnDuty: doc.isOnDuty ?? false,
    isBlocked: doc.isBlocked ?? false,
    blockedReason: doc.blockedReason ?? null,
    joinedAt: doc.createdAt ?? new Date(),
    rating: doc.rating ?? 5.0,
    ratingCount: doc.ratingCount ?? 0,
    totalTrips: doc.totalTrips ?? doc.ratingCount ?? 0,
    lastRideAt: doc.lastRideAt ?? null,
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
  if (patch.vehicleTypePreferences !== undefined) {
    set['vehicleTypePreferences'] = patch.vehicleTypePreferences;
  }
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
    // Typed against the document, not `any`: `strictQuery` is on (see shared/db/mongo.ts), so a
    // filter naming a field the schema does not have throws at runtime. Catching that here is the
    // whole point — an `any` filter turns a typo into a query that silently matches everything.
    const query: mongoose.FilterQuery<DriverDoc> = {};

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

  async verifyHillDriving(driverId: string, verified: boolean): Promise<DriverProfile | undefined> {
    if (!mongoose.Types.ObjectId.isValid(driverId)) return undefined;

    const doc = await DriverModel.findByIdAndUpdate(
      driverId,
      { $set: { canDriveHillVerified: verified } },
      { new: true }
    ).lean().exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawDriver);
  }

  async setBlockedStatus(driverId: string, isBlocked: boolean, reason: string | null): Promise<DriverProfile | undefined> {
    if (!mongoose.Types.ObjectId.isValid(driverId)) return undefined;

    const setPayload: mongoose.UpdateQuery<DriverDoc> = {
      isBlocked,
      blockedReason: isBlocked ? (reason ?? null) : null,
    };
    // If the driver is being blocked, force them off-duty so they can't stay online
    if (isBlocked) {
      setPayload.isOnDuty = false;
    }

    const doc = await DriverModel.findByIdAndUpdate(
      driverId,
      { $set: setPayload },
      { new: true }
    ).lean().exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawDriver);
  }

  async findLiveDrivers(filter?: LiveDriverFilter): Promise<LiveDriverRecord[]> {
    const query: Record<string, unknown> = {
      'lastLocation.coordinates': { $exists: true, $ne: null },
      lastLocationAt: { $ne: null },
      isBlocked: { $ne: true },
    };

    if (filter?.dutyOnly) {
      query.isOnDuty = true;
    }

    if (filter?.maxAgeMinutes) {
      const cutoff = new Date(Date.now() - filter.maxAgeMinutes * 60_000);
      query.lastLocationAt = { $gte: cutoff };
    }

    const docs = await DriverModel.find(query)
      .select('fullName phone lastLocation lastLocationAt canDriveHill vehicleCategoryPreference isOnDuty')
      .lean()
      .exec();

    return docs
      .filter((doc) => doc.lastLocation && Array.isArray(doc.lastLocation.coordinates) && doc.lastLocation.coordinates.length >= 2)
      .map((doc) => ({
        id: String(doc._id),
        fullName: doc.fullName ?? null,
        mobileNumber: doc.phone,
        lat: doc.lastLocation!.coordinates[1]!,
        lng: doc.lastLocation!.coordinates[0]!,
        lastLocationAt: doc.lastLocationAt ?? new Date(),
        canDriveHill: doc.canDriveHill ?? false,
        vehicleCategories: (doc.vehicleCategoryPreference ?? []) as CarCategory[],
        isOnDuty: doc.isOnDuty ?? false,
      }));
  }

  async sweepStalePresence(cutoff: Date, limit: number): Promise<string[]> {
    /*
     * SELECTED FIRST, THEN UPDATED, rather than one `updateMany`.
     *
     * The caller has to notify the drivers it took offline, and an `updateMany` reports how many
     * documents it touched but not which — so there would be no way to tell anyone. Reading the
     * ids first costs one extra query per sweep and is what makes the notification possible.
     *
     * `limit` bounds the read for the same reason every sweep query is bounded: the first run
     * after an outage could match every driver in the collection, and the sweeper must not spend
     * a minute-long tick on one enormous batch. Whatever it misses, it catches next minute.
     *
     * The `isOnDuty: true` predicate is what makes this idempotent — a driver swept last tick no
     * longer matches, so a re-run cannot notify them twice.
     */
    const stale = await DriverModel.find({
      isOnDuty: true,
      $or: [{ lastLocationAt: { $lt: cutoff } }, { lastLocationAt: null }],
    })
      .select('_id')
      .limit(limit)
      .lean()
      .exec();

    const ids = stale.map((doc) => String(doc._id));
    if (ids.length === 0) return [];

    /*
     * The same predicate is repeated in the write, not just the id list. Between the read above
     * and this update a driver's app may have come back and flushed a fresh fix — re-checking
     * `isOnDuty` and the cutoff means the write skips anyone who recovered in that window rather
     * than knocking a now-healthy driver offline.
     */
    await DriverModel.updateMany(
      {
        _id: { $in: ids },
        isOnDuty: true,
        $or: [{ lastLocationAt: { $lt: cutoff } }, { lastLocationAt: null }],
      },
      { $set: { isOnDuty: false } },
    ).exec();

    return ids;
  }
}
