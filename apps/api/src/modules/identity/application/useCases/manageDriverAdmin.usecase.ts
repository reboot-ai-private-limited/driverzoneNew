import { AppError } from '@/shared/errors/AppError.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type {
  DriverProfile,
  DriverProfilePatch,
  DriverProfileRepositoryPort,
} from '../../domain/driverProfile.repository.port.js';
import type { ActorContext } from './verifyDriver.usecase.js';

/**
 * APPLICATION — reading and editing ONE driver's profile as an admin.
 *
 * Audited, like customer edits and driver approvals. Only writes are audited;
 * reading is not audited.
 */
export class ManageDriverAdminUseCase {
  constructor(
    private readonly drivers: DriverProfileRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async get(driverId: string): Promise<DriverProfile> {
    const driver = await this.drivers.findById(driverId);
    if (driver === undefined) throw AppError.notFound('That driver could not be found.');
    return driver;
  }

  async update(
    driverId: string,
    patch: DriverProfilePatch,
    actor: ActorContext,
  ): Promise<DriverProfile> {
    const before = await this.get(driverId);

    const after = await this.drivers.updateProfile(driverId, patch);
    if (after === undefined) throw AppError.notFound('That driver could not be found.');

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'Driver',
      entityId: driverId,
      action: 'UPDATE',
      before: changedFields(before, patch),
      after: changedFields(after, patch),
      ip: actor.ip,
    });

    return after;
  }
}

/** The values of exactly the fields the patch mentions — nothing else reaches the audit log. */
function changedFields(
  profile: DriverProfile,
  patch: DriverProfilePatch,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.fullName !== undefined) out['fullName'] = profile.fullName;
  if (patch.dob !== undefined) out['dob'] = profile.dob;
  if (patch.gender !== undefined) out['gender'] = profile.gender;
  if (patch.experienceYears !== undefined) out['experienceYears'] = profile.experienceYears;
  if (patch.alternatePhone !== undefined) out['alternatePhone'] = profile.alternatePhone;
  if (patch.emergencyContact !== undefined) out['emergencyContact'] = profile.emergencyContact;
  if (patch.address !== undefined) out['address'] = profile.address;
  if (patch.vehicleTypePreferences !== undefined) {
    out['vehicleTypePreferences'] = profile.vehicleTypePreferences;
  }
  if (patch.vehicleCategoryPreference !== undefined) {
    out['vehicleCategoryPreference'] = profile.vehicleCategoryPreference;
  }
  if (patch.canDriveHill !== undefined) out['canDriveHill'] = profile.canDriveHill;
  return out;
}
