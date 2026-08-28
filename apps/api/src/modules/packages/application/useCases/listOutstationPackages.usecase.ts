import type { PackageRepositoryPort, ListOutstationFilter } from '../../domain/packageRepository.port.js';
import type { OutstationPackage } from '../../domain/outstationPackage.entity.js';

export class ListOutstationPackagesUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  async execute(filter: ListOutstationFilter): Promise<OutstationPackage[]> {
    return this.repo.listOutstation(filter);
  }
}
