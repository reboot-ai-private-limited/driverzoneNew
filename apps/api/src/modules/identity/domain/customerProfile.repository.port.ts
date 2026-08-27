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
  /** When the account was created — the moment they first verified an OTP. Admin list only. */
  joinedAt: Date;
  /** Last write of any kind, from Mongoose's `timestamps`. Shown on the admin detail screen. */
  updatedAt: Date;
  /** Set by an admin only. Never by the customer themselves — see `CustomerProfilePatch`. */
  isBlocked: boolean;
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
  /** Admin-only. No customer blocks themselves, so this never arrives from the self-serve route. */
  isBlocked?: boolean;
}

/** Mirrors `DriverListFilter` — same shape, so both admin directories filter identically. */
export interface CustomerListFilter {
  /** Matches name, mobile number or number plate. Substring, case-insensitive. */
  search?: string;
  isBlocked?: boolean;
}

export interface PaginatedCustomers {
  customers: CustomerProfile[];
  totalItems: number;
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

  /**
   * The admin directory. Filtered, sorted and paged IN MONGO, exactly as `findPaginated` does
   * for drivers.
   *
   * Not fetched whole and sliced in the caller: the customer collection grows with every signup
   * and every row is PII, so loading all of it to render ten rows gets slower every week and
   * puts thousands of unrelated phone numbers through a process with no use for them.
   */
  findPaginated(
    filter: CustomerListFilter,
    page: number,
    limit: number,
  ): Promise<PaginatedCustomers>;
}
