import type { Gender } from '@driverzone/contracts';
import type { SavedAddress, Vehicle } from './customerProfile.entity.js';

/**
 * PORT — a customer's profile, addresses and vehicles.
 *
 * Separate from `account.repository.port.ts`, which stays deliberately narrow: the auth flow
 * needs an id and a name, and widening it to carry the whole profile surface would drag
 * addresses and vehicles into a boundary that has no use for them.
 */

export interface CustomerProfile {
  id: string;
  mobileNumber: string;
  fullName: string | null;
  dob: Date | null;
  gender: Gender | null;
  languagesKnown: string[];
  alternatePhone: string | null;
  emergencyContact: { name: string; phone: string } | null;
  savedAddresses: SavedAddress[];
  vehicles: Vehicle[];
}

/**
 * A patch. An absent key leaves the field alone; an explicit `null` clears it.
 *
 * Those are different intents and the type has to keep them apart — "only updating my name"
 * versus "remove my alternate number". Collapsing them would make clearing a field impossible.
 */
export interface CustomerProfilePatch {
  fullName?: string;
  dob?: Date | null;
  gender?: Gender | null;
  languagesKnown?: string[];
  alternatePhone?: string | null;
  emergencyContact?: { name: string; phone: string } | null;
}

export interface CustomerProfileRepositoryPort {
  findById(customerId: string): Promise<CustomerProfile | undefined>;

  updateProfile(customerId: string, patch: CustomerProfilePatch): Promise<CustomerProfile | undefined>;

  /**
   * Replaces the whole address list.
   *
   * Whole-list rather than per-item, because the "only one default" invariant spans every
   * element: setting a new default clears the old one, so the write is inherently about the
   * collection. A per-item update would need two round trips and could interleave with another
   * request to leave two defaults set.
   */
  replaceAddresses(customerId: string, addresses: SavedAddress[]): Promise<SavedAddress[]>;

  replaceVehicles(customerId: string, vehicles: Vehicle[]): Promise<Vehicle[]>;
}
