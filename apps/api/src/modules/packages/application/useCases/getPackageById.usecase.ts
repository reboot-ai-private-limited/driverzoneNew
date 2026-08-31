import type { PackageRepositoryPort } from '../../domain/packageRepository.port.js';
import type { IncityPackage } from '../../domain/incityPackage.entity.js';
import type { OutstationPackage } from '../../domain/outstationPackage.entity.js';
import { PackageNotFoundError } from '../../domain/package.errors.js';

export type ServiceType = 'INCITY' | 'OUTSTATION';

export class GetPackageByIdUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  /**
   * Overloaded so a caller that names the service type statically gets back the matching entity
   * rather than the union. The controllers each know which one they are, and without this every
   * one of them would need a cast to hand its package to the right DTO mapper — a cast being
   * exactly the thing that stops the mapper from being checked.
   */
  async execute(id: string, serviceType: 'INCITY'): Promise<IncityPackage>;
  async execute(id: string, serviceType: 'OUTSTATION'): Promise<OutstationPackage>;
  async execute(id: string, serviceType: ServiceType): Promise<IncityPackage | OutstationPackage>;
  async execute(id: string, serviceType: ServiceType): Promise<IncityPackage | OutstationPackage> {
    const pkg =
      serviceType === 'INCITY'
        ? await this.repo.findIncityById(id)
        : await this.repo.findOutstationById(id);

    if (!pkg) throw new PackageNotFoundError(id);
    return pkg;
  }
}
