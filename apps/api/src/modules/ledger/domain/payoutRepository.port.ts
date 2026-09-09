import type { Payout, NewPayout, PayoutStatus } from './payout.entity.js';

export interface PayoutListFilter {
  driverId?: string | undefined;
  status?: PayoutStatus | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
}

export interface PayoutRepositoryPort {
  create(payout: NewPayout): Promise<Payout>;
  findById(id: string): Promise<Payout | null>;
  listPaginated(
    filter: PayoutListFilter,
    page: number,
    limit: number,
  ): Promise<{ payouts: Payout[]; totalItems: number }>;
}
