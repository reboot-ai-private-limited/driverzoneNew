import { rupeesToPaise, type SettingsReadContract } from '../../../settings/settings.public.js';
import type { LedgerEntry } from '../../domain/ledgerEntry.entity.js';
import type { LedgerRepositoryPort } from '../../domain/ledgerRepository.port.js';

export interface DriverWallet {
  balancePaise: number;
  lifetimeEarningsPaise: number;
  /** True when the debt has passed the threshold dispatch already filters on. */
  isSuspendedForBalance: boolean;
  entries: LedgerEntry[];
  /**
   * The balance immediately after the NEWEST row on this page — the point the running balance is
   * walked back from. On page 1 it is the current balance; on later pages it is that minus
   * everything newer, which is why it is computed here rather than assumed by the mapper.
   */
  anchorBalancePaise: number;
  totalItems: number;
}

/**
 * A driver's wallet as an admin needs to see it.
 *
 * This replaces a hardcoded stub that returned `balance_paise: 0` and an empty ledger *"until the
 * finance module is integrated"*. The finance module is this one — and the stub stops being merely
 * incomplete the moment cash ships, because then a driver genuinely holds the company's money and
 * the screen an admin would check to find that out reports zero.
 *
 * `isSuspendedForBalance` is computed against the SAME setting `MongoDriverPool` filters dispatch
 * on, rather than a second threshold that could disagree: the screen says a driver is suspended
 * exactly when dispatch has actually stopped offering them work.
 */
export class GetDriverWalletUseCase {
  constructor(
    private readonly repo: LedgerRepositoryPort,
    private readonly settings: SettingsReadContract,
  ) {}

  async execute(driverId: string, page: number, limit: number, fromDate?: Date, toDate?: Date): Promise<DriverWallet> {
    const [balancePaise, lifetimeEarningsPaise, pageResult, snapshot] = await Promise.all([
      this.repo.sumForDriver(driverId),
      this.repo.sumEarningsForDriver(driverId),
      this.repo.pageForDriver(driverId, page, limit, fromDate, toDate),
      this.settings.snapshot(),
    ]);

    const maxDebtPaise = rupeesToPaise(snapshot['driver.max_negative_balance']);

    // Everything newer than the first row of this page, so the walk starts from the right number
    // even if the page itself was fetched with date filters.
    let newerSum = 0;
    const first = pageResult.entries[0];
    if (first !== undefined) {
      newerSum = await this.repo.sumNewerThan(driverId, first.createdAt, first.id);
    } else {
      // If the page is empty, the anchor balance is just the current balance minus anything newer
      // than the toDate (if provided). But since there are no rows to display, the anchor balance
      // doesn't matter for rendering anyway. We can just use 0.
      newerSum = 0;
    }

    return {
      balancePaise,
      lifetimeEarningsPaise,
      isSuspendedForBalance: balancePaise < -maxDebtPaise,
      entries: pageResult.entries,
      anchorBalancePaise: balancePaise - newerSum,
      totalItems: pageResult.totalItems,
    };
  }
}
