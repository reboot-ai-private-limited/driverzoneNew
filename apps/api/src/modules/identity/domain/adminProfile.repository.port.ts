/**
 * PORT — an admin's own profile.
 *
 * Read and rename only. There is no create and no delete: admin records are provisioned out of
 * band, which is the residual safeguard that replaced the second auth factor
 * (docs/decision-log.md, 2026-08-24). `mobileNumber` is absent from the patch because it is the
 * credential — changing it is an account handover, not a profile edit.
 */
export interface AdminProfile {
  id: string;
  mobileNumber: string;
  fullName: string;
}

export interface AdminProfileRepositoryPort {
  findById(adminId: string): Promise<AdminProfile | undefined>;

  updateProfile(adminId: string, patch: { fullName?: string }): Promise<AdminProfile | undefined>;
}
