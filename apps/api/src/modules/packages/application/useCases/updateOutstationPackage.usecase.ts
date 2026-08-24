import type { PackageRepositoryPort, CreateOutstationPackageData } from '../../domain/packageRepository.port.js';
import type { OutstationPackage } from '../../domain/outstationPackage.entity.js';
import { validateOutstationBand, validateOutstationPackageActivation } from '../../domain/outstationPackage.entity.js';
import { InvalidBandError, InvalidPackageError, OverlappingBandError, PackageNotFoundError } from '../../domain/package.errors.js';

export class UpdateOutstationPackageUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  async execute(id: string, data: Partial<CreateOutstationPackageData>): Promise<OutstationPackage> {
    const existing = await this.repo.findOutstationById(id);
    if (!existing) throw new PackageNotFoundError(id);

    const mergedMinKm = data.minKm ?? existing.minKm;
    const mergedMaxKm = data.maxKm ?? existing.maxKm;
    const mergedTerrain = data.terrain ?? existing.terrain;
    const mergedPickupZoneIds = data.pickupZoneIds ?? existing.pickupZoneIds;
    const mergedPrices = data.prices ?? existing.prices;
    const mergedIsActive = data.isActive ?? existing.isActive;

    const bandError = validateOutstationBand(mergedMinKm, mergedMaxKm);
    if (bandError) throw new InvalidBandError(bandError);

    if (mergedIsActive !== false) {
      const reason = validateOutstationPackageActivation({
        pickupZoneIds: mergedPickupZoneIds,
        prices: mergedPrices,
      });
      if (reason) throw new InvalidPackageError(reason);
    }

    const conflict = await this.repo.findOverlappingBands({
      terrain: mergedTerrain,
      minKm: mergedMinKm,
      maxKm: mergedMaxKm,
      pickupZoneIds: mergedPickupZoneIds,
      excludeId: id,
    });
    if (conflict) throw new OverlappingBandError(conflict.id);

    const updated = await this.repo.updateOutstation(id, data);
    if (!updated) throw new PackageNotFoundError(id);

    return updated;
  }
}
