import type { LedgerRepositoryPort } from '../../domain/ledgerRepository.port.js';

/**
 * The driver's balance, summed from the ledger.
 *
 * THIS IS THE SOURCE OF TRUTH, not `drivers.walletBalancePaise`. That field is a cache, kept so
 * the dispatch eligibility query can filter on a balance without an aggregation per candidate;
 * it is recomputed by the nightly reconcile job and alerted on when it drifts. Anything making a
 * decision about money — a payout, a block, a settlement — reads this.
 *
 * Negative means the driver owes the company, which is the normal state of a driver taking cash
 * fares: they hold the fare and have earned only their share of it.
 */
export class GetWalletBalanceUseCase {
  constructor(private readonly repo: LedgerRepositoryPort) {}

  execute(driverId: string): Promise<number> {
    return this.repo.sumForDriver(driverId);
  }
}
