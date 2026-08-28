import type { PackageRepositoryPort, CreateOutstationPackageData } from '../../domain/packageRepository.port.js';
import type { OutstationPackage } from '../../domain/outstationPackage.entity.js';
import { validateOutstationBand } from '../../domain/outstationPackage.entity.js';
import { InvalidBandError, OverlappingBandError } from '../../domain/package.errors.js';

export class CreateOutstationPackageUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  async execute(data: CreateOutstationPackageData): Promise<OutstationPackage> {
    const bandError = validateOutstationBand(data.minKm, data.maxKm);
    if (bandError) throw new InvalidBandError(bandError);

    // No P-3 check: `oneWayFarePaise` is required, so an outstation band cannot be active and
    // unsellable. See the note where `validateOutstationPackageActivation` used to live.

    const conflict = await this.repo.findOverlappingBands({
      terrain: data.terrain,
      minKm: data.minKm,
      maxKm: data.maxKm,
    });
    if (conflict) throw new OverlappingBandError(conflict.id);

    return this.repo.createOutstation(data);
  }
}
