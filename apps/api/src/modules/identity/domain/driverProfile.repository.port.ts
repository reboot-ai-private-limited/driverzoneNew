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
  /** Currently on duty. What `MongoDriverPool` filters on when picking who to ring. */
  isOnDuty: boolean;
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

  /**
   * Go on or off duty.
   *
   * Separate from `updateProfile` because it is not a profile edit: it is an operational flag
   * that dispatch reads on every wave, and the use case that calls it enforces a gate
   * (`isVerified`) that no other profile field has.
   */
  setDutyStatus(driverId: string, isOnDuty: boolean): Promise<DriverProfile | undefined>;

  /**
   * The driver's current position, and when it was taken.
   *
   * Both are written together because `MongoDriverPool` reads them together — a `lastLocation`
   * without a matching `lastLocationAt` is a position of unknown age, which the freshness filter
   * has to treat as no position at all.
   */
  recordLocation(
    driverId: string,
    fix: { lat: number; lng: number; recordedAt: Date },
  ): Promise<DriverProfile | undefined>;

  /**
   * Take every on-duty driver who has stopped reporting their position off duty. Returns the ids
   * of the ones it changed, so the caller can tell them.
   *
   * THE BACKSTOP FOR AN APP THAT DIED WITHOUT SAYING SO (docs/LLD/driver-app.md S-1). A driver's
   * process can be force-stopped, killed by an OEM battery manager, or lost to a reboot, and none
   * of those run a line of the app's code — so `isOnDuty` stays true for ever while the handset
   * pings nothing. Dispatch already declines to ring them, because `MongoDriverPool` filters on
   * `lastLocationAt` freshness, so the immediate harm is not misrouted trips. It is that NOBODY
   * KNOWS: the driver's app still says "You're online", the admin panel still counts them as
   * supply, and the driver waits out a shift that ended when their phone decided it had.
   *
   * `cutoff` should be comfortably wider than the pool's own freshness window — this is meant to
   * catch a handset that is gone, not one in a lift or a tunnel, and taking a working driver off
   * duty for a two-minute dead spot would be a far worse bug than the one it fixes.
   *
   * A null `lastLocationAt` counts as stale: it means the driver went on duty and never reported a
   * single fix, which is the fresh-install case where the app was killed before its first flush.
   */
  sweepStalePresence(cutoff: Date, limit: number): Promise<string[]>;
}
