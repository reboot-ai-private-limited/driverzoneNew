import { AppError } from '@/shared/errors/AppError.js';
import type {
  DriverProfile,
  DriverProfileRepositoryPort,
} from '../../domain/driverProfile.repository.port.js';

/** APPLICATION — read a driver's own profile, including their verification state. */
export class GetDriverProfileUseCase {
  constructor(private readonly drivers: DriverProfileRepositoryPort) {}

  async execute(driverId: string): Promise<DriverProfile> {
    const profile = await this.drivers.findById(driverId);
    if (profile === undefined) throw AppError.notFound('Your profile could not be found.');
    return profile;
  }
}
