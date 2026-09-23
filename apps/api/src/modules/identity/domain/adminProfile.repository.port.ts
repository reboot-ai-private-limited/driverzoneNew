import type { AdminRole } from '@driverzone/contracts';

/**
 * PORT — an admin's own profile.
 *
 * Read and rename only. Creating, re-roling and deactivating OTHER admins is a different
 * surface with a different guard — see `AdminRosterRepositoryPort`. `mobileNumber` is absent from
 * the patch because it is the credential — changing it is an account handover, not a profile edit.
 */
export interface AdminProfile {
  id: string;
  mobileNumber: string;
  fullName: string;
  adminRole: AdminRole;
}

export interface AdminProfileRepositoryPort {
  findById(adminId: string): Promise<AdminProfile | undefined>;

  updateProfile(adminId: string, patch: { fullName?: string }): Promise<AdminProfile | undefined>;
}
