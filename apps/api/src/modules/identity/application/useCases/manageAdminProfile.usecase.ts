import { AppError } from '@/shared/errors/AppError.js';
import type {
  AdminProfile,
  AdminProfileRepositoryPort,
} from '../../domain/adminProfile.repository.port.js';

/**
 * APPLICATION — an admin's own profile.
 *
 * Read and rename only. Creating and managing OTHER admins is `ManageAdminsUseCase`, behind the
 * SUPER_ADMIN guard (docs/decision-log.md, 2026-09-23). `mobileNumber` is not editable either — it
 * is the credential, so changing it is an account handover rather than a profile edit.
 */
export class ManageAdminProfileUseCase {
  constructor(private readonly admins: AdminProfileRepositoryPort) {}

  async get(adminId: string): Promise<AdminProfile> {
    const profile = await this.admins.findById(adminId);
    if (profile === undefined) throw AppError.notFound('Your profile could not be found.');
    return profile;
  }

  async update(adminId: string, patch: { fullName?: string }): Promise<AdminProfile> {
    const updated = await this.admins.updateProfile(adminId, patch);
    if (updated === undefined) throw AppError.notFound('Your profile could not be found.');
    return updated;
  }
}
