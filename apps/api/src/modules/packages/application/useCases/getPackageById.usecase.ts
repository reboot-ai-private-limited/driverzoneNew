import type { PackageRepositoryPort } from '../../domain/packageRepository.port.js';
import type { IncityPackage } from '../../domain/incityPackage.entity.js';
import type { OutstationPackage } from '../../domain/outstationPackage.entity.js';
import { PackageNotFoundError } from '../../domain/package.errors.js';

export type ServiceType = 'INCITY' | 'OUTSTATION';

export class GetPackageByIdUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  async execute(id: string, serviceType: ServiceType): Promise<IncityPackage | OutstationPackage> {
    const pkg =
      serviceType === 'INCITY'
        ? await this.repo.findIncityById(id)
        : await this.repo.findOutstationById(id);

    if (!pkg) throw new PackageNotFoundError(id);
    return pkg;
  }
}
