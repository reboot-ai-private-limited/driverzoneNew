import type { OutstationPackagePatch, PackageRepositoryPort } from '../../domain/packageRepository.port.js';
import type { OutstationPackage } from '../../domain/outstationPackage.entity.js';
import {
  validateOutstationBand,
  validateOutstationDriverAmounts,
  validateOutstationVariantAmounts,
} from '../../domain/outstationPackage.entity.js';
import {
  DriverAmountError,
  InvalidBandError,
  OverlappingBandError,
  PackageNotFoundError,
} from '../../domain/package.errors.js';

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

    // On the MERGE, not the patch: an update touching only the driver amount still has to clear
    // the stored fares, and one touching only a fare has to stay above the stored amount.
    // `roundTripFarePaise` is nullable, so `'x' in data` is the test for "the patch set it" —
    // `??` would swap a deliberate `null` for the old value.
    const amountError = validateOutstationDriverAmounts({
      oneWayFarePaise: data.oneWayFarePaise ?? existing.oneWayFarePaise,
      roundTripFarePaise:
        'roundTripFarePaise' in data ? (data.roundTripFarePaise ?? null) : existing.roundTripFarePaise,
      oneWayDriverAmountPaise:
        data.oneWayDriverAmountPaise ?? existing.oneWayDriverAmountPaise,
      roundTripDriverAmountPaise:
        'roundTripDriverAmountPaise' in data
          ? (data.roundTripDriverAmountPaise ?? null)
          : existing.roundTripDriverAmountPaise,
    });
    if (amountError) throw new DriverAmountError(amountError);

    const variantError = validateOutstationVariantAmounts({
      variants: data.variants ?? existing.variants,
    });
    if (variantError) throw new DriverAmountError(variantError);

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
