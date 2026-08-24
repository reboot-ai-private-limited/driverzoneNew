import mongoose from 'mongoose';
import type { Gender } from '@driverzone/contracts';
import type { SavedAddress, Vehicle } from '../domain/customerProfile.entity.js';
import type {
  CustomerProfile,
  CustomerProfilePatch,
  CustomerProfileRepositoryPort,
} from '../domain/customerProfile.repository.port.js';
import { CustomerModel } from './customer.model.js';

/**
 * INFRASTRUCTURE — customer profiles, addresses and vehicles over Mongoose.
 *
 * Two shape mismatches are absorbed here so the domain never sees them:
 *
 *   - Addresses store GeoJSON `[lng, lat]`; the domain and the wire both use `{ lat, lng }`.
 *     Getting that order backwards puts Siliguri in the Indian Ocean, so the swap happens in
 *     exactly these two functions and nowhere else.
 *   - Subdocument identity is an application-generated `adr_`/`veh_` string, not Mongo's
 *     `_id`. That keeps ids stable across the whole-list rewrites below and makes them
 *     self-describing in a support ticket.
 */

interface StoredAddress {
  entryId: string;
  label: string;
  address: string;
  point?: { type: string; coordinates: number[] } | null;
  isDefault?: boolean;
  isPreferredPickup?: boolean;
}

interface StoredVehicle {
  entryId: string;
  category: string;
  plateNumber: string;
  fuelType?: string | null;
  isDefault?: boolean;
}

function addressToDomain(a: StoredAddress): SavedAddress {
  const coords = a.point?.coordinates ?? [];
  return {
    id: a.entryId,
    label: (a.label as SavedAddress['label']) ?? 'OTHER',
    address: a.address,
    // GeoJSON is [lng, lat] — the reverse of how humans write it.
    lat: coords[1] ?? 0,
    lng: coords[0] ?? 0,
    isDefault: a.isDefault ?? false,
    isPreferredPickup: a.isPreferredPickup ?? false,
  };
}

function addressToStored(a: SavedAddress): StoredAddress {
  return {
    entryId: a.id,
    label: a.label,
    address: a.address,
    point: { type: 'Point', coordinates: [a.lng, a.lat] },
    isDefault: a.isDefault,
    isPreferredPickup: a.isPreferredPickup,
  };
}

function vehicleToDomain(v: StoredVehicle): Vehicle {
  return {
    id: v.entryId,
    category: v.category,
    plateNumber: v.plateNumber,
    fuelType: (v.fuelType as Vehicle['fuelType']) ?? null,
    isDefault: v.isDefault ?? false,
  };
}

function vehicleToStored(v: Vehicle): StoredVehicle {
  return {
    entryId: v.id,
    category: v.category,
    plateNumber: v.plateNumber,
    fuelType: v.fuelType,
    isDefault: v.isDefault,
  };
}

interface RawCustomer {
  _id: mongoose.Types.ObjectId;
  phone: string;
  fullName?: string | null;
  dob?: Date | null;
  gender?: string | null;
  languagesKnown?: string[];
  alternatePhone?: string | null;
  emergencyContact?: { name?: string; phone?: string } | null;
  savedAddresses?: unknown[];
  vehicles?: unknown[];
}

function toDomain(doc: RawCustomer): CustomerProfile {
  const contact = doc.emergencyContact;
  return {
    id: String(doc._id),
    mobileNumber: doc.phone,
    fullName: doc.fullName ?? null,
    dob: doc.dob ?? null,
    gender: (doc.gender as Gender | null) ?? null,
    languagesKnown: doc.languagesKnown ?? [],
    alternatePhone: doc.alternatePhone ?? null,
    // A subdocument with neither field set is stored absence, not a contact.
    emergencyContact:
      contact?.name !== undefined && contact.phone !== undefined
        ? { name: contact.name, phone: contact.phone }
        : null,
    savedAddresses: ((doc.savedAddresses ?? []) as StoredAddress[]).map(addressToDomain),
    vehicles: ((doc.vehicles ?? []) as StoredVehicle[]).map(vehicleToDomain),
  };
}

/**
 * Builds a `$set` from a patch.
 *
 * The distinction the whole shape exists to preserve: an ABSENT key leaves the field alone, an
 * explicit `null` clears it. Spreading the patch directly would write `undefined` into Mongo for
 * every field the caller did not mention, wiping a profile on a one-field edit.
 */
function toSet(patch: CustomerProfilePatch): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (patch.fullName !== undefined) set['fullName'] = patch.fullName;
  if (patch.dob !== undefined) set['dob'] = patch.dob;
  if (patch.gender !== undefined) set['gender'] = patch.gender;
  if (patch.languagesKnown !== undefined) set['languagesKnown'] = patch.languagesKnown;
  if (patch.alternatePhone !== undefined) set['alternatePhone'] = patch.alternatePhone;
  if (patch.emergencyContact !== undefined) set['emergencyContact'] = patch.emergencyContact;
  return set;
}

export class MongoCustomerProfileRepository implements CustomerProfileRepositoryPort {
  async findById(customerId: string): Promise<CustomerProfile | undefined> {
    if (!mongoose.Types.ObjectId.isValid(customerId)) return undefined;
    const doc = await CustomerModel.findById(customerId).lean().exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawCustomer);
  }

  async updateProfile(
    customerId: string,
    patch: CustomerProfilePatch,
  ): Promise<CustomerProfile | undefined> {
    if (!mongoose.Types.ObjectId.isValid(customerId)) return undefined;

    const set = toSet(patch);
    // An empty patch is a read, not a write — Mongo rejects an empty `$set`.
    if (Object.keys(set).length === 0) return this.findById(customerId);

    const doc = await CustomerModel.findByIdAndUpdate(customerId, { $set: set }, { new: true })
      .lean()
      .exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawCustomer);
  }

  async replaceAddresses(customerId: string, addresses: SavedAddress[]): Promise<SavedAddress[]> {
    const doc = await CustomerModel.findByIdAndUpdate(
      customerId,
      { $set: { savedAddresses: addresses.map(addressToStored) } },
      { new: true },
    )
      .lean()
      .exec();
    return doc === null ? [] : toDomain(doc as unknown as RawCustomer).savedAddresses;
  }

  async replaceVehicles(customerId: string, vehicles: Vehicle[]): Promise<Vehicle[]> {
    const doc = await CustomerModel.findByIdAndUpdate(
      customerId,
      { $set: { vehicles: vehicles.map(vehicleToStored) } },
      { new: true },
    )
      .lean()
      .exec();
    return doc === null ? [] : toDomain(doc as unknown as RawCustomer).vehicles;
  }
}
