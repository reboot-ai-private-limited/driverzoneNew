import type { Router } from 'express';
import type { SettingsReadContract } from '../settings/settings.public.js';
import type { LedgerPublicContract } from './ledger.public.js';
import { MongoLedgerRepository } from './infrastructure/ledgerRepository.impl.js';
import { MongoPayoutRepository } from './infrastructure/payoutRepository.impl.js';
import { AppendLedgerEntriesUseCase } from './application/useCases/appendEntries.usecase.js';
import { GetWalletBalanceUseCase } from './application/useCases/getWalletBalance.usecase.js';
import { GetDriverWalletUseCase } from './application/useCases/getDriverWallet.usecase.js';
import { AdjustDriverWalletUseCase } from './application/useCases/adjustDriverWallet.usecase.js';
import { ProcessPayoutUseCase } from './application/useCases/processPayout.usecase.js';
import { ListPayoutsUseCase } from './application/useCases/listPayouts.usecase.js';
import {
  makeDriverWalletController,
  makeAdjustDriverWalletController,
  makeCreatePayoutController,
  makeListPayoutsController,
} from './interface/ledger.controller.js';
import { buildAdminRouter, buildPayoutRouter } from './interface/ledger.routes.js';

export interface LedgerDependencies {
  /** For `driver.max_negative_balance` — the same figure dispatch filters on. */
  settings: SettingsReadContract;
}

export interface LedgerContainer {
  contract: LedgerPublicContract;
  /** Mounted at `/api/admin/drivers`. The driver's earnings screen is a mobile app, still absent. */
  buildAdminRouter: () => Router;
  /** Mounted at `/api/admin/payouts`. Manages settlement payouts to drivers. */
  buildPayoutRouter: () => Router;
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

  return {
    contract: {
      append: (entries) => append.execute(entries),
      walletBalance: (driverId) => balance.execute(driverId),
      lifetimeEarnings: (driverId) => repo.sumEarningsForDriver(driverId),
      entriesForBooking: (bookingId) => repo.listForBooking(bookingId),
      recentEntriesForDriver: (driverId, limit) => repo.listForDriver(driverId, limit),
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
  };
}

