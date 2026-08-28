import type {
  DriverProfileRepositoryPort,
  DriverListFilter,
  DriverProfile,
} from '../../domain/driverProfile.repository.port.js';

export interface ListDriversAdminResult {
  drivers: DriverProfile[];
  totalItems: number;
}

export class ListDriversAdminUseCase {
  constructor(private readonly drivers: DriverProfileRepositoryPort) {}

  async execute(
    filter: DriverListFilter,
    page: number,
    limit: number
  ): Promise<ListDriversAdminResult> {
    return this.drivers.findPaginated(filter, page, limit);
  }
}
