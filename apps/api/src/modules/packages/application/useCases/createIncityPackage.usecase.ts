import type { PackageRepositoryPort, CreateIncityPackageData } from '../../domain/packageRepository.port.js';
import type { IncityPackage } from '../../domain/incityPackage.entity.js';
import { validateIncityPackageActivation } from '../../domain/incityPackage.entity.js';
import { InvalidPackageError } from '../../domain/package.errors.js';

export class CreateIncityPackageUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  async execute(data: CreateIncityPackageData): Promise<IncityPackage> {
    if (data.isActive !== false) {
      const reason = validateIncityPackageActivation(data);
      if (reason) throw new InvalidPackageError(reason);
    }

    // P-1: every pickupZoneId must belong to cityZoneId's parent
    // Deferred until zones module provides ZoneResolutionContract

    return this.repo.createIncity(data);
  }
}
