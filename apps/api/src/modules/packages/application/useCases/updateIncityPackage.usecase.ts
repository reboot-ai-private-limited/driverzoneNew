import type { PackageRepositoryPort, CreateIncityPackageData } from '../../domain/packageRepository.port.js';
import type { IncityPackage } from '../../domain/incityPackage.entity.js';
import { validateIncityPackageActivation } from '../../domain/incityPackage.entity.js';
import { InvalidPackageError, PackageNotFoundError } from '../../domain/package.errors.js';

export class UpdateIncityPackageUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  async execute(id: string, data: Partial<CreateIncityPackageData>): Promise<IncityPackage> {
    const existing = await this.repo.findIncityById(id);
    if (!existing) throw new PackageNotFoundError(id);

    // If changing variants/pickupZones/isActive, validate activation rules
    if (data.isActive !== false) {
      const mergedForValidation = {
        variants: data.variants ?? existing.variants,
      };

      const reason = validateIncityPackageActivation(mergedForValidation);
      if (reason) throw new InvalidPackageError(reason);
    }

    const updated = await this.repo.updateIncity(id, data);
    if (!updated) throw new PackageNotFoundError(id);

    return updated;
  }
}
