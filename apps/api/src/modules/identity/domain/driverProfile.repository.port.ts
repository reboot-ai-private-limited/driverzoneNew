import type { Gender, OnboardingStatus, VehicleTypePreference } from '@driverzone/contracts';

/** PORT — a driver's profile and their onboarding/verification state. */

export interface DriverProfile {
  id: string;
  mobileNumber: string;
  fullName: string | null;
  dob: Date | null;
  gender: Gender | null;
  experienceYears: number | null;
  alternatePhone: string | null;
  emergencyContact: { name: string; phone: string } | null;
  address: string | null;
  vehicleTypePreference: VehicleTypePreference | null;
  vehicleCategoryPreference: string[];
  canDriveHill: boolean;
  canDriveHillVerified: boolean;
  onboardingStatus: OnboardingStatus;
  onboardingRejectionReason: string | null;
  isVerified: boolean;
}

export interface DriverProfilePatch {
  fullName?: string;
  dob?: Date | null;
  gender?: Gender | null;
  experienceYears?: number | null;
  alternatePhone?: string | null;
  emergencyContact?: { name: string; phone: string } | null;
  address?: string | null;
  vehicleTypePreference?: VehicleTypePreference | null;
  vehicleCategoryPreference?: string[];
  /**
   * Self-declaration only. A driver may set this; it gates nothing until an admin sets
   * `canDriveHillVerified`, which is not reachable through this patch at all — hill driving in
   * the Darjeeling region is a safety matter (docs/LLD/12-open-questions.md Q6).
   */
  canDriveHill?: boolean;
}

export interface DriverProfileRepositoryPort {
  findById(driverId: string): Promise<DriverProfile | undefined>;

  updateProfile(driverId: string, patch: DriverProfilePatch): Promise<DriverProfile | undefined>;

  setOnboardingStatus(
    driverId: string,
    status: OnboardingStatus,
    rejectionReason: string | null,
  ): Promise<DriverProfile | undefined>;

  /**
   * The approval write, and it is ONE call on purpose.
   *
   * `isVerified` is what dispatch and `POST /driver/duty` gate on; `onboardingStatus` is what
   * the driver's app renders. Two separate methods would let a caller set one without the
   * other, which is exactly the drift `docs/LLD/03-database-schema.md` warns about — a driver
   * showing "approved" who cannot go on duty, or worse, the reverse.
   */
  approve(driverId: string, adminId: string, at: Date): Promise<DriverProfile | undefined>;
}
