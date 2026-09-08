import type { Router } from 'express';
import type { SettingsReadContract } from '../settings/settings.public.js';
import type { LedgerFinanceContract, LedgerPublicContract } from './ledger.public.js';
import { MongoLedgerRepository } from './infrastructure/ledgerRepository.impl.js';
import { MongoPayoutRepository } from './infrastructure/payoutRepository.impl.js';
import { AppendLedgerEntriesUseCase } from './application/useCases/appendEntries.usecase.js';
import { GetWalletBalanceUseCase } from './application/useCases/getWalletBalance.usecase.js';
import { GetDriverWalletUseCase } from './application/useCases/getDriverWallet.usecase.js';
import { AdjustDriverWalletUseCase } from './application/useCases/adjustDriverWallet.usecase.js';
import { ProcessPayoutUseCase } from './application/useCases/processPayout.usecase.js';
import { ListPayoutsUseCase } from './application/useCases/listPayouts.usecase.js';
import { GetDriverBalancesUseCase } from './application/useCases/getDriverBalances.usecase.js';
import { SettleDriverUseCase } from './application/useCases/settleDriver.usecase.js';
import {
  makeDriverWalletController,
  makeAdjustDriverWalletController,
  makeCreatePayoutController,
  makeListPayoutsController,
  makeMyWalletController,
} from './interface/ledger.controller.js';
import { buildAdminRouter, buildDriverRouter, buildPayoutRouter } from './interface/ledger.routes.js';

export interface LedgerDependencies {
  /** For `driver.max_negative_balance` — the same figure dispatch filters on. */
  settings: SettingsReadContract;
}

export interface LedgerContainer {
  contract: LedgerPublicContract;
  /**
   * The cross-driver reads, handed only to the tier-8 `admin` module.
   *
   * Separate from `contract` so `bookings` — which takes `LedgerPublicContract` — is not also
   * handed a query that walks every driver in the system.
   */
  financeContract: LedgerFinanceContract;
  /** Mounted at `/api/admin/drivers`, for `/admin/drivers/:id/wallet`. */
  buildAdminRouter: () => Router;
  buildPayoutRouter: () => Router;
  /**
   * Mounted at `/api/driver/wallet` — the driver's own earnings screen.
   *
   * The same `GetDriverWalletUseCase` instance as the admin router above, not a second one: one
   * derivation of the running balance means the driver's app and the admin's screen cannot
   * disagree about what a driver is owed.
   */
  buildDriverRouter: () => Router;
}

export function buildLedgerContainer(deps: LedgerDependencies): LedgerContainer {
  const repo = new MongoLedgerRepository();
  const payoutRepo = new MongoPayoutRepository();

  const append = new AppendLedgerEntriesUseCase(repo);
  const balance = new GetWalletBalanceUseCase(repo);
  const wallet = new GetDriverWalletUseCase(repo, deps.settings);
  const adjust = new AdjustDriverWalletUseCase(repo);
  const processPayout = new ProcessPayoutUseCase(repo, payoutRepo);
  const listPayouts = new ListPayoutsUseCase(payoutRepo);
  const balances = new GetDriverBalancesUseCase(repo, deps.settings);
  const settle = new SettleDriverUseCase(repo);

  return {
    contract: {
      append: (entries) => append.execute(entries),
      walletBalance: (driverId) => balance.execute(driverId),
      lifetimeEarnings: (driverId) => repo.sumEarningsForDriver(driverId),
      entriesForBooking: (bookingId) => repo.listForBooking(bookingId),
      recentEntriesForDriver: (driverId, limit) => repo.listForDriver(driverId, limit),
    },
    financeContract: {
      driverBalances: (input, page, limit) => balances.execute(input, page, limit),
      settleDriver: (input) => settle.execute(input),
      feed: async (page, limit, query) => {
        // Rows and totals together: the caller always needs both, and issuing them in parallel
        // here keeps that one round trip rather than two sequential ones at the edge.
        const [result, totals] = await Promise.all([
          repo.pageAll(page, limit, query),
          repo.totalsAll(query),
        ]);
        return { entries: result.entries, totals, totalItems: result.totalItems };
      },
    },
    buildAdminRouter: () =>
      buildAdminRouter({
        driverWallet: makeDriverWalletController(wallet),
        adjustWallet: makeAdjustDriverWalletController(adjust),
      }),
    buildPayoutRouter: () =>
      buildPayoutRouter({
        createPayout: makeCreatePayoutController(processPayout),
        listPayouts: makeListPayoutsController(listPayouts),
      }),
    buildDriverRouter: () => buildDriverRouter({ myWallet: makeMyWalletController(wallet) }),
  };
}

