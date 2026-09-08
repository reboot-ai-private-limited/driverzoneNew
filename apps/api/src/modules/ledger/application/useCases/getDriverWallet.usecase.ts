import { rupeesToPaise, type SettingsReadContract } from '../../../settings/settings.public.js';
import type {
  LedgerEntryWithBalance,
  LedgerQuery,
  LedgerRepositoryPort,
  LedgerTotals,
} from '../../domain/ledgerRepository.port.js';

export interface DriverWallet {
  balancePaise: number;
  lifetimeEarningsPaise: number;
  /** True when the debt has passed the threshold dispatch already filters on. */
  isSuspendedForBalance: boolean;
  /** Each row with the balance that stood after it, straight from the repository's window sum. */
  entries: LedgerEntryWithBalance[];
  /** Totals for everything the query selects — every page of it, not the page returned. */
  totals: LedgerTotals;
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

  /**
   * `query` filters the STATEMENT ONLY, never the wallet.
   *
   * `balance_paise` and `lifetime_earnings_paise` stay whole-history figures whatever is filtered,
   * because they are facts about the driver rather than about the rows on screen: a driver who
   * filters to "bonuses" has not stopped owing the cash they collected yesterday, and a balance
   * that moved when a chip was tapped would be the most alarming possible way to say so. What the
   * filter does change is `totals`, which is explicitly about the selection.
   */
  async execute(
    driverId: string,
    page: number,
    limit: number,
    query?: LedgerQuery | undefined,
  ): Promise<DriverWallet> {
    const [balancePaise, lifetimeEarningsPaise, pageResult, totals, snapshot] = await Promise.all([
      this.repo.sumForDriver(driverId),
      this.repo.sumEarningsForDriver(driverId),
      this.repo.pageForDriver(driverId, page, limit, query),
      this.repo.totalsForDriver(driverId, query),
      this.settings.snapshot(),
    ]);

    const maxDebtPaise = rupeesToPaise(snapshot['driver.max_negative_balance']);

    return {
      balancePaise,
      lifetimeEarningsPaise,
      isSuspendedForBalance: balancePaise < -maxDebtPaise,
      entries: pageResult.entries,
      totals,
      totalItems: pageResult.totalItems,
    };
  }
}
