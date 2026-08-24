import { AppError } from '@/shared/errors/AppError.js';
import type {
  CustomerProfile,
  CustomerProfileRepositoryPort,
} from '../../domain/customerProfile.repository.port.js';

/**
 * APPLICATION — read a customer's own profile.
 *
 * `notFound` rather than an empty profile when the record is missing: the caller arrived with a
 * valid token, so a missing record means the account was deleted mid-session, and inventing a
 * blank profile would hide that.
 */
export class GetCustomerProfileUseCase {
  constructor(private readonly customers: CustomerProfileRepositoryPort) {}

  async execute(customerId: string): Promise<CustomerProfile> {
    const profile = await this.customers.findById(customerId);
    if (profile === undefined) throw AppError.notFound('Your profile could not be found.');
    return profile;
  }
}
