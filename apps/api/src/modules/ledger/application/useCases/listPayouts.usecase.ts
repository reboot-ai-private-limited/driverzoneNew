import type {
  PayoutRepositoryPort,
  PayoutListFilter,
} from '../../domain/payoutRepository.port.js';
import type { Payout } from '../../domain/payout.entity.js';

export interface ListPayoutsResult {
  payouts: Payout[];
  totalItems: number;
  totalPages: number;
  page: number;
  limit: number;
}

export class ListPayoutsUseCase {
  constructor(private readonly payoutRepo: PayoutRepositoryPort) {}

  async execute(
    filter: PayoutListFilter,
    page: number = 1,
    limit: number = 20,
  ): Promise<ListPayoutsResult> {
    const { payouts, totalItems } = await this.payoutRepo.listPaginated(filter, page, limit);

    return {
      payouts,
      totalItems,
      totalPages: Math.ceil(totalItems / limit) || 1,
      page,
      limit,
    };
  }
}
