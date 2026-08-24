import { AppError } from '@/shared/errors/AppError.js';
import type {
  CustomerProfile,
  CustomerProfilePatch,
  CustomerProfileRepositoryPort,
} from '../../domain/customerProfile.repository.port.js';

/**
 * APPLICATION — edit a customer's own profile.
 *
 * There is nothing to validate beyond what Zod already did at the boundary, and deliberately no
 * required-field check: customer profiles complete progressively and no field beyond the phone
 * number is ever mandatory (docs/LLD/user.md §Customer).
 */
export class UpdateCustomerProfileUseCase {
  constructor(private readonly customers: CustomerProfileRepositoryPort) {}

  async execute(customerId: string, patch: CustomerProfilePatch): Promise<CustomerProfile> {
    const updated = await this.customers.updateProfile(customerId, patch);
    if (updated === undefined) throw AppError.notFound('Your profile could not be found.');
    return updated;
  }
}
