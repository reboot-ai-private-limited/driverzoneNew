import type {
  CustomerListFilter,
  CustomerProfile,
  CustomerProfileRepositoryPort,
} from '../../domain/customerProfile.repository.port.js';

export interface ListCustomersAdminResult {
  customers: CustomerProfile[];
  totalItems: number;
}

/**
 * APPLICATION — the admin customer directory. The counterpart to `ListDriversAdminUseCase`, and
 * deliberately the same shape.
 *
 * Separate from `GetCustomerProfileUseCase`, which stays narrow: that one is reached only from
 * `/customer/profile` and acts on `req.principal`, so it has no way to name anybody but the
 * caller. Widening it to take an arbitrary id is exactly how an admin-shaped hole appears in the
 * customer app's own surface.
 */
export class ListCustomersAdminUseCase {
  constructor(private readonly customers: CustomerProfileRepositoryPort) {}

  async execute(
    filter: CustomerListFilter,
    page: number,
    limit: number,
  ): Promise<ListCustomersAdminResult> {
    return this.customers.findPaginated(filter, page, limit);
  }
}
