import { AppError } from '@/shared/errors/AppError.js';
import type {
  DriverProfile,
  DriverProfilePatch,
  DriverProfileRepositoryPort,
} from '../../domain/driverProfile.repository.port.js';

/**
 * APPLICATION — edit a driver's own profile.
 *
 * Editing is allowed in every onboarding state, including `SUBMITTED`. That is deliberate: a
 * driver who spots a typo while waiting in the review queue should fix it rather than be told to
 * wait for a rejection first.
 *
 * What this CANNOT touch is anything an admin owns — `isVerified`, `onboardingStatus`,
 * `canDriveHillVerified`. Those are absent from `DriverProfilePatch` entirely, so the boundary
 * is a type error rather than a runtime check somebody has to remember to write.
 */
export class UpdateDriverProfileUseCase {
  constructor(private readonly drivers: DriverProfileRepositoryPort) {}

  async execute(driverId: string, patch: DriverProfilePatch): Promise<DriverProfile> {
    const updated = await this.drivers.updateProfile(driverId, patch);
    if (updated === undefined) throw AppError.notFound('Your profile could not be found.');
    return updated;
  }
}
