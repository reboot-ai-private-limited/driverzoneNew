import type { AdminRole } from '@driverzone/contracts';

/**
 * PORT — the set of people who can sign in to the admin panel, as a SUPER_ADMIN manages it.
 *
 * Separate from `AdminProfileRepositoryPort`, which is an admin editing THEMSELVES. Folding the
 * two together would put "create an administrator" one method away from a route every admin can
 * reach, which is the exact hole the roles exist to close.
 */
export interface AdminRosterEntry {
  id: string;
  mobileNumber: string;
  fullName: string;
  adminRole: AdminRole;
  isActive: boolean;
  createdAt: Date;
  deactivatedAt: Date | null;
}

/** A change to one admin that could reduce how many active super admins there are. */
export interface GuardedAdminChange {
  adminRole?: AdminRole;
  /** `false` deactivates and records who did it; `true` reactivates and clears that. */
  isActive?: boolean;
  fullName?: string;
  byAdminId: string;
}

export interface AdminRosterRepositoryPort {
  list(): Promise<AdminRosterEntry[]>;

  /** Any row with this id, active or not — the roster shows deactivated admins too. */
  findById(adminId: string): Promise<AdminRosterEntry | undefined>;

  /** Any row with this number, active or not. A number can belong to only one admin row. */
  findByPhone(phone: string): Promise<AdminRosterEntry | undefined>;

  create(input: {
    phone: string;
    fullName: string;
    adminRole: AdminRole;
    createdBy: string;
  }): Promise<AdminRosterEntry>;

  /**
   * Apply a change and REFUSE it if it would leave no active super admin.
   *
   * The check and the write are one transaction, and two concurrent demotions of different super
   * admins cannot both pass: each is made to write every remaining super admin, so they conflict
   * and one is retried against the other's result. A read-then-write in the use case would let
   * two admins each demote the other and lock everybody out of the roster.
   *
   * Resolves `undefined` when the admin does not exist; rejects with `lastSuperAdmin()` when the
   * change is refused.
   */
  changeGuarded(adminId: string, change: GuardedAdminChange): Promise<AdminRosterEntry | undefined>;
}
