import type {
  CarCategory,
  Gender,
  OnboardingStatus,
  VehicleTypePreference,
} from '@driverzone/contracts';

/** PORT — a driver's profile and their onboarding/verification state. */

export interface DriverProfile {
  id: string;
  mobileNumber: string;
  fullName: string | null;
  profilePicture: string | null;
  dob: Date | null;
  gender: Gender | null;
  experienceYears: number | null;
  alternatePhone: string | null;
  emergencyContact: { name: string; phone: string } | null;
  address: string | null;
  vehicleTypePreferences: VehicleTypePreference[];
  vehicleCategoryPreference: CarCategory[];
  canDriveHill: boolean;
  canDriveHillVerified: boolean;
  onboardingStatus: OnboardingStatus;
  onboardingRejectionReason: string | null;
  isVerified: boolean;
}

export interface DriverProfilePatch {
  fullName?: string;
  profilePicture?: string | null;
  dob?: Date | null;
  gender?: Gender | null;
  experienceYears?: number | null;
  alternatePhone?: string | null;
  emergencyContact?: { name: string; phone: string } | null;
  address?: string | null;
  vehicleTypePreferences?: VehicleTypePreference[];
  vehicleCategoryPreference?: CarCategory[];
  /**
   * Self-declaration only. A driver may set this; it gates nothing until an admin sets
   * `canDriveHillVerified`, which is not reachable through this patch at all — hill driving in
   * the Darjeeling region is a safety matter (docs/LLD/open-questions.md Q6).
   */
  canDriveHill?: boolean;
}

export interface DriverListFilter {
  onboardingStatus?: OnboardingStatus;
  isVerified?: boolean;
  search?: string;
}

export interface PaginatedDrivers {
  drivers: DriverProfile[];
  totalItems: number;
}

export interface DriverProfileRepositoryPort {
  findById(driverId: string): Promise<DriverProfile | undefined>;

  findPaginated(filter: DriverListFilter, page: number, limit: number): Promise<PaginatedDrivers>;

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
   * other, which is exactly the drift `docs/LLD/database-schema.md` warns about — a driver
   * showing "approved" who cannot go on duty, or worse, the reverse.
   */
  approve(driverId: string, adminId: string, at: Date): Promise<DriverProfile | undefined>;
}
