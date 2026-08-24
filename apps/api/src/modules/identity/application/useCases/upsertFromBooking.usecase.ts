import type { AddressLabel } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { newAddressId, newVehicleId } from '@/shared/ids.js';
import {
  applyAddressFlags,
  applyVehicleFlags,
  defaultsForFirstAddress,
  defaultsForFirstVehicle,
  findAddressAtSamePlace,
  findVehicleByPlate,
} from '../../domain/customerProfile.entity.js';
import type { SavedAddress, Vehicle } from '../../domain/customerProfile.entity.js';
import type { CustomerProfileRepositoryPort } from '../../domain/customerProfile.repository.port.js';

export interface UpsertAddressFromBookingInput {
  label: AddressLabel;
  address: string;
  lat: number;
  lng: number;
  isPreferredPickup?: boolean | undefined;
}

export interface UpsertVehicleFromBookingInput {
  category: string;
  plateNumber: string;
  fuelType?: string | undefined;
}

/**
 * APPLICATION — the save-at-booking path behind `CustomerBookingProfileContract`.
 *
 * This is the mechanism for customer progressive profile completion: rather than sending someone
 * through a setup wizard, the booking flow offers to keep the pickup address and car they just
 * chose (docs/LLD/13-auth-and-user.md §Module contract).
 *
 * Separate from `ManageAddressesUseCase` despite the overlap, because the semantics differ in a
 * way that matters: these are UPSERTS keyed on the real-world identity of the thing — position
 * for an address, number plate for a car — and they never fail. A customer booking twice from
 * home must end with one saved address, and a duplicate must never turn into an error that
 * fails the booking. `ManageAddresses.add` is the opposite: an explicit user action, where a
 * duplicate plate is worth reporting.
 */
export class UpsertFromBookingUseCase {
  constructor(private readonly customers: CustomerProfileRepositoryPort) {}

  async upsertAddress(customerId: string, input: UpsertAddressFromBookingInput): Promise<string> {
    const profile = await this.customers.findById(customerId);
    if (profile === undefined) throw AppError.notFound('Your profile could not be found.');

    const existing = profile.savedAddresses;

    // Same place already saved: keep it, and only ever ADD the preferred-pickup flag. Silently
    // relabelling or moving an address the customer curated would be the booking flow
    // overwriting a deliberate choice.
    const atSamePlace = findAddressAtSamePlace(existing, input.lat, input.lng);
    if (atSamePlace !== undefined) {
      if (input.isPreferredPickup === true && !atSamePlace.isPreferredPickup) {
        const promoted = existing.map((a) =>
          a.id === atSamePlace.id ? { ...a, isPreferredPickup: true } : a,
        );
        await this.customers.replaceAddresses(customerId, applyAddressFlags(promoted, atSamePlace.id));
      }
      return atSamePlace.id;
    }

    const auto = defaultsForFirstAddress(existing.length);
    const created: SavedAddress = {
      id: newAddressId(),
      label: input.label,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      isDefault: auto.isDefault,
      isPreferredPickup: input.isPreferredPickup ?? auto.isPreferredPickup,
    };

    await this.customers.replaceAddresses(customerId, applyAddressFlags([...existing, created], created.id));
    return created.id;
  }

  async upsertVehicle(customerId: string, input: UpsertVehicleFromBookingInput): Promise<string> {
    const profile = await this.customers.findById(customerId);
    if (profile === undefined) throw AppError.notFound('Your profile could not be found.');

    const existing = profile.vehicles;

    const known = findVehicleByPlate(existing, input.plateNumber);
    if (known !== undefined) return known.id;

    const created: Vehicle = {
      id: newVehicleId(),
      category: input.category,
      plateNumber: input.plateNumber,
      // Narrowed by the caller's own validation; stored as-is or not at all rather than guessed.
      fuelType: null,
      isDefault: defaultsForFirstVehicle(existing.length).isDefault,
    };

    await this.customers.replaceVehicles(customerId, applyVehicleFlags([...existing, created], created.id));
    return created.id;
  }
}
