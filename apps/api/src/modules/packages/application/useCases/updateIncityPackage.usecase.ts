import type { IncityPackagePatch, PackageRepositoryPort } from '../../domain/packageRepository.port.js';
import type { IncityPackage } from '../../domain/incityPackage.entity.js';
import { validateIncityPackageActivation } from '../../domain/incityPackage.entity.js';
import { InvalidPackageError, PackageNotFoundError } from '../../domain/package.errors.js';

export class UpdateIncityPackageUseCase {
  constructor(private readonly repo: PackageRepositoryPort) {}

  async execute(id: string, data: IncityPackagePatch): Promise<IncityPackage> {
    const existing = await this.repo.findIncityById(id);
    if (!existing) throw new PackageNotFoundError(id);

    /**
     * P-3 applies to the package as it will BE after this write, so the check runs on the merge
     * of the patch over what is stored — not on the patch alone, which would let an omitted
     * `variants` skip the check entirely.
     *
     * `data.isActive ?? existing.isActive` and not `data.isActive !== false`: an update that
     * omits the flag on an already-inactive package is not an activation, and demanding a
     * sellable price row before it would block ops from editing a draft.
     * `updateOutstationPackage.usecase.ts` has always done it this way; this is the twin.
     */
    const mergedIsActive = data.isActive ?? existing.isActive;
    if (mergedIsActive !== false) {
      const reason = validateIncityPackageActivation({
        variants: data.variants ?? existing.variants,
      });
      if (reason) throw new InvalidPackageError(reason);
    }

    /**
     * TODO — `updateIncity` is a `findByIdAndUpdate` with the raw patch, so sending `variants`
     * REPLACES the array and mints fresh subdocument `_id`s. Price-row ids are meant to be
     * stable: a frozen fare snapshot cites `price_row_id`
     * (docs/LLD/pricing-and-commission.md §Snapshot). Nothing consumes them yet — `quotes` does
     * not exist — but this needs a subdocument merge before it does.
     */
    const updated = await this.repo.updateIncity(id, data);
    if (!updated) throw new PackageNotFoundError(id);

    return updated;
  }
}
