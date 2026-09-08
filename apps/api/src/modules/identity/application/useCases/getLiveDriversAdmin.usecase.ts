import type {
  DriverProfileRepositoryPort,
  LiveDriverFilter,
  LiveDriverRecord,
} from '../../domain/driverProfile.repository.port.js';

export interface LiveDriversAdminResult {
  drivers: LiveDriverRecord[];
  totalActive: number;
}

/**
 * APPLICATION — positions for the Ops live tracking map.
 *
 * Reads live drivers with recent locations and duty status.
 */
export class GetLiveDriversAdminUseCase {
  constructor(private readonly driverRepo: DriverProfileRepositoryPort) {}

  async execute(filter?: LiveDriverFilter): Promise<LiveDriversAdminResult> {
    const drivers = await this.driverRepo.findLiveDrivers(filter);
    const totalActive = drivers.filter((d) => d.isOnDuty).length;

    return {
      drivers,
      totalActive,
    };
  }
}
