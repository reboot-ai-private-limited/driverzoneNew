import type { PackageRepositoryPort, CreateIncityPackageData } from '../../domain/packageRepository.port.js';
import type { IncityPackage } from '../../domain/incityPackage.entity.js';
import {
  validateIncityDriverAmounts,
  validateIncityPackageActivation,
} from '../../domain/incityPackage.entity.js';
import { DriverAmountError, InvalidPackageError } from '../../domain/package.errors.js';

export class CreateIncityPackageUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  async execute(data: CreateIncityPackageData): Promise<IncityPackage> {
    // Runs whether or not the package is active — a saved-but-inactive draft with a driver amount
    // above its fare is a landmine for whoever activates it later.
    const amountError = validateIncityDriverAmounts(data);
    if (amountError) throw new DriverAmountError(amountError);

    if (data.isActive !== false) {
      const reason = validateIncityPackageActivation(data);
      if (reason) throw new InvalidPackageError(reason);
    }

    // P-1: every pickupZoneId must belong to cityZoneId's parent
    // Deferred until zones module provides ZoneResolutionContract

    return this.repo.createIncity(data);
  }
}
