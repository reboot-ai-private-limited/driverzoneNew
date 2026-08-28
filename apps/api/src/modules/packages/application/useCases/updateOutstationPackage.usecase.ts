import type { OutstationPackagePatch, PackageRepositoryPort } from '../../domain/packageRepository.port.js';
import type { OutstationPackage } from '../../domain/outstationPackage.entity.js';
import { validateOutstationBand } from '../../domain/outstationPackage.entity.js';
import { InvalidBandError, OverlappingBandError, PackageNotFoundError } from '../../domain/package.errors.js';

export class UpdateOutstationPackageUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  async execute(id: string, data: OutstationPackagePatch): Promise<OutstationPackage> {
    const existing = await this.repo.findOutstationById(id);
    if (!existing) throw new PackageNotFoundError(id);

    const mergedMinKm = data.minKm ?? existing.minKm;
    const mergedMaxKm = data.maxKm ?? existing.maxKm;
    const mergedTerrain = data.terrain ?? existing.terrain;

    const bandError = validateOutstationBand(mergedMinKm, mergedMaxKm);
    if (bandError) throw new InvalidBandError(bandError);

    // No P-3 check here either — the fare is a required field on the band, so there is no
    // "active but unsellable" state left for an update to create.

    const conflict = await this.repo.findOverlappingBands({
      terrain: mergedTerrain,
      minKm: mergedMinKm,
      maxKm: mergedMaxKm,
      excludeId: id,
    });
    if (conflict) throw new OverlappingBandError(conflict.id);

    const updated = await this.repo.updateOutstation(id, data);
    if (!updated) throw new PackageNotFoundError(id);

    return updated;
  }
}
