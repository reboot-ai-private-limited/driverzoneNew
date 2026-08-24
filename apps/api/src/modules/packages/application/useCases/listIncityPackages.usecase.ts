import type { PackageRepositoryPort, ListPackageFilter } from '../../domain/packageRepository.port.js';
import type { IncityPackage } from '../../domain/incityPackage.entity.js';

export class ListIncityPackagesUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  async execute(filter: ListPackageFilter): Promise<IncityPackage[]> {
    return this.repo.listIncity(filter);
  }
}
