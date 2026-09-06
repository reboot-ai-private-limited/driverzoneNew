import { rupeesToPaise, type SettingsReadContract } from '../../../settings/settings.public.js';
import type {
  DriverBalanceAggregate,
  DriverBalanceQuery,
  DriverBalanceRow,
  LedgerRepositoryPort,
} from '../../domain/ledgerRepository.port.js';

/** One driver on the collections screen, with the suspension verdict already applied. */
export interface DriverBalance extends DriverBalanceRow {
  /** True when this driver's debt has passed the threshold dispatch filters on. */
  isSuspendedForBalance: boolean;
}

export interface DriverBalancesPage {
  rows: DriverBalance[];
  totals: DriverBalanceAggregate;
  totalItems: number;
}

/** What the caller asks for, before the suspension threshold has been resolved from settings. */
export type DriverBalancesInput = Omit<
  DriverBalanceQuery,
  'suspendedThresholdPaise' | 'suspendedOnly'
> & {
  /** Restrict to drivers dispatch should have stopped offering work to. */
  suspendedOnly?: boolean | undefined;
};

/**
 * Every driver with ledger activity and what they stand at — the finance collections view.
 *
 * THE SUSPENSION PREDICATE LIVES HERE, not in the aggregation and not in the caller. It is the
 * same comparison `GetDriverWalletUseCase` makes against the same setting `MongoDriverPool`
 * filters dispatch on, so a driver reads as suspended on this screen exactly when dispatch has
 * stopped offering them work. Three copies of `balance < -threshold` would be three chances for
 * the finance screen to disagree with the system it is describing.
 *
 * A KNOWN DISCREPANCY THIS SCREEN WILL EXPOSE: dispatch filters on `drivers.walletBalancePaise`,
 * which has no writer anywhere in this codebase and is therefore permanently 0 — so the gate it
 * implements never actually fires. This use case computes the real balance from the rows, so a
 * driver can legitimately show as suspended here while dispatch is still offering them trips.
 * That is the cache being broken, not this calculation; fixing it means giving that column a
 * writer (a nightly recompute), which is deliberately not part of this screen.
 */
export class GetDriverBalancesUseCase {
  constructor(
    private readonly repo: LedgerRepositoryPort,
    private readonly settings: SettingsReadContract,
  ) {}

  async execute(
    input: DriverBalancesInput,
    page: number,
    limit: number,
  ): Promise<DriverBalancesPage> {
    /*
     * Settings first, because the threshold is an INPUT to the query rather than something
     * applied to its result. Handing the repository the number lets the suspended filter and the
     * suspended count both run inside the aggregation, across every matching driver — counting
     * them here instead would only ever see the page.
     */
    const snapshot = await this.settings.snapshot();
    const maxDebtPaise = rupeesToPaise(snapshot['driver.max_negative_balance']);

    const result = await this.repo.pageDriverBalances(
      { ...input, suspendedThresholdPaise: maxDebtPaise },
      page,
      limit,
    );

    return {
      rows: result.rows.map((row) => ({
        ...row,
        isSuspendedForBalance: row.balancePaise < -maxDebtPaise,
      })),
      totals: result.totals,
      totalItems: result.totalItems,
    };
  }
}
