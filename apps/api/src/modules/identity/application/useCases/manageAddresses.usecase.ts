import type { AddressLabel } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { newAddressId } from '@/shared/ids.js';
// Note: no position-based deduplication here, unlike `upsertFromBooking.usecase.ts`. Saving two
// addresses at the same coordinates is a legitimate explicit action — a house and the flat above
// it — and silently merging them would override a deliberate choice. Dedup belongs only on the
// booking side, where the save is an automatic side effect rather than something asked for.
import { applyAddressFlags, defaultsForFirstAddress } from '../../domain/customerProfile.entity.js';
import type { SavedAddress } from '../../domain/customerProfile.entity.js';
import type { CustomerProfileRepositoryPort } from '../../domain/customerProfile.repository.port.js';

export interface AddAddressInput {
  label: AddressLabel;
  address: string;
  lat: number;
  lng: number;
  isDefault?: boolean | undefined;
  isPreferredPickup?: boolean | undefined;
}

export type UpdateAddressInput = Partial<AddAddressInput>;

/**
 * APPLICATION — a customer's saved addresses.
 *
 * Grouped into one class rather than split across three near-identical files, because all three
 * operations are the same transaction against the same collection: read the list, change one
 * element, re-apply the "only one default" invariant across the whole thing, write it back.
 * Splitting them would duplicate that read-modify-write in triplicate while the rule that makes
 * it non-trivial lives in `customerProfile.entity.ts` regardless.
 */
export class ManageAddressesUseCase {
  constructor(private readonly customers: CustomerProfileRepositoryPort) {}

  private async load(customerId: string): Promise<SavedAddress[]> {
    const profile = await this.customers.findById(customerId);
    if (profile === undefined) throw AppError.notFound('Your profile could not be found.');
    return profile.savedAddresses;
  }

  async add(customerId: string, input: AddAddressInput): Promise<SavedAddress> {
    const existing = await this.load(customerId);

    // The first address a customer saves becomes their default and preferred pickup: with only
    // one possible answer, making them pick it is pure friction.
    const auto = defaultsForFirstAddress(existing.length);

    const created: SavedAddress = {
      id: newAddressId(),
      label: input.label,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      isDefault: input.isDefault ?? auto.isDefault,
      isPreferredPickup: input.isPreferredPickup ?? auto.isPreferredPickup,
    };

    const next = applyAddressFlags([...existing, created], created.id);
    const saved = await this.customers.replaceAddresses(customerId, next);

    const result = saved.find((a) => a.id === created.id);
    if (result === undefined) throw AppError.internal('INTERNAL', { reason: 'address vanished on write' });
    return result;
  }

  async update(customerId: string, addressId: string, input: UpdateAddressInput): Promise<SavedAddress> {
    const existing = await this.load(customerId);
    if (!existing.some((a) => a.id === addressId)) throw AppError.notFound('That address could not be found.');

    const merged = existing.map((a) =>
      a.id === addressId
        ? {
            ...a,
            ...(input.label === undefined ? {} : { label: input.label }),
            ...(input.address === undefined ? {} : { address: input.address }),
            ...(input.lat === undefined ? {} : { lat: input.lat }),
            ...(input.lng === undefined ? {} : { lng: input.lng }),
            ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
            ...(input.isPreferredPickup === undefined ? {} : { isPreferredPickup: input.isPreferredPickup }),
          }
        : a,
    );

    // Re-applied on every update, not only when a flag was passed: a caller may have set
    // isDefault on an address that was already default, and the invariant must hold regardless.
    const next = applyAddressFlags(merged, addressId);
    const saved = await this.customers.replaceAddresses(customerId, next);

    const result = saved.find((a) => a.id === addressId);
    if (result === undefined) throw AppError.notFound('That address could not be found.');
    return result;
  }

  async remove(customerId: string, addressId: string): Promise<void> {
    const existing = await this.load(customerId);
    if (!existing.some((a) => a.id === addressId)) throw AppError.notFound('That address could not be found.');

    const remaining = existing.filter((a) => a.id !== addressId);

    /**
     * Deleting the default promotes whatever is left, rather than leaving a customer with
     * addresses and no default — a state the booking flow would have to special-case forever.
     * The first remaining entry is an arbitrary but stable choice.
     */
    const removed = existing.find((a) => a.id === addressId);
    const first = remaining[0];
    if (first !== undefined && removed !== undefined) {
      if (removed.isDefault) first.isDefault = true;
      if (removed.isPreferredPickup) first.isPreferredPickup = true;
    }

    await this.customers.replaceAddresses(customerId, remaining);
  }
}
