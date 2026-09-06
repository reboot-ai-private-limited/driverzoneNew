import type { Router } from 'express';
import type {
  AccountDirectoryContract,
  CustomerContactContract,
  DriverCardContract,
} from '../identity/identity.public.js';
import type { LedgerFinanceContract } from '../ledger/ledger.public.js';
import type { WalletFinanceContract } from '../wallet/wallet.public.js';
import {
  makeCustomerWalletsController,
  makeDriverBalancesController,
  makeFinanceTransactionsController,
  makeSettleDriverController,
} from './interface/finance.controller.js';
import { buildFinanceRouter } from './interface/finance.routes.js';

/**
 * TIER 8 — the top of the graph. Nothing may depend on this module, which is what lets it read
 * across every other one.
 *
 * IT HAS NO `infrastructure/` AND MUST NOT GROW ONE. Its whole job is composition: take contracts
 * from modules that own data, join them, and map the result to the wire. The screens it serves —
 * finance today, a dashboard and an audit log later — are cross-cutting by nature, and that is
 * exactly the shape that has nowhere else to live: `ledger` and `wallet` are the same tier and
 * may not import each other, so no module that owns money data can serve a screen showing both.
 *
 * The rule to keep it honest: if logic wants to live here, it belongs in the module that owns the
 * rows. This module knows how to ASK, not how to decide.
 */
export interface AdminDependencies {
  /** Cross-driver balances and the ledger feed. Not `LedgerPublicContract` — see that file. */
  ledger: LedgerFinanceContract;
  /** Cross-customer wallet balances. */
  wallet: WalletFinanceContract;
  /** Names and phones for ids this module holds, and search-term → ids. */
  identity: AccountDirectoryContract & DriverCardContract & CustomerContactContract;
}

export interface AdminContainer {
  /** Mounted at `/api/admin/finance`. */
  buildFinanceRouter: () => Router;
}

export function buildAdminContainer(deps: AdminDependencies): AdminContainer {
  return {
    buildFinanceRouter: () =>
      buildFinanceRouter({
        driverBalances: makeDriverBalancesController(deps.ledger, deps.identity),
        transactions: makeFinanceTransactionsController(deps.ledger, deps.identity),
        customerWallets: makeCustomerWalletsController(deps.wallet, deps.identity),
        settleDriver: makeSettleDriverController(deps.ledger),
      }),
  };
}
