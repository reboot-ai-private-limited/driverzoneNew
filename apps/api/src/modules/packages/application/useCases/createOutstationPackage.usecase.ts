import type { PackageRepositoryPort, CreateOutstationPackageData } from '../../domain/packageRepository.port.js';
import type { OutstationPackage } from '../../domain/outstationPackage.entity.js';
import { validateOutstationBand, validateOutstationPackageActivation } from '../../domain/outstationPackage.entity.js';
import { InvalidBandError, InvalidPackageError, OverlappingBandError } from '../../domain/package.errors.js';

export class CreateOutstationPackageUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  async execute(data: CreateOutstationPackageData): Promise<OutstationPackage> {
    const bandError = validateOutstationBand(data.minKm, data.maxKm);
    if (bandError) throw new InvalidBandError(bandError);

    if (data.isActive !== false) {
      const reason = validateOutstationPackageActivation(data);
      if (reason) throw new InvalidPackageError(reason);
    }

    const conflict = await this.repo.findOverlappingBands({
      terrain: data.terrain,
      minKm: data.minKm,
      maxKm: data.maxKm,
      pickupZoneIds: data.pickupZoneIds,
    });
    if (conflict) throw new OverlappingBandError(conflict.id);

    return this.repo.createOutstation(data);
  }
}
