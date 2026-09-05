import type { Router } from 'express';
import type { SettingsReadContract } from '../settings/settings.public.js';
import type { LedgerPublicContract } from './ledger.public.js';
import { MongoLedgerRepository } from './infrastructure/ledgerRepository.impl.js';
import { AppendLedgerEntriesUseCase } from './application/useCases/appendEntries.usecase.js';
import { GetWalletBalanceUseCase } from './application/useCases/getWalletBalance.usecase.js';
import { GetDriverWalletUseCase } from './application/useCases/getDriverWallet.usecase.js';
import { makeDriverWalletController, makeMyWalletController } from './interface/ledger.controller.js';
import { buildAdminRouter, buildDriverRouter } from './interface/ledger.routes.js';

export interface LedgerDependencies {
  /** For `driver.max_negative_balance` — the same figure dispatch filters on. */
  settings: SettingsReadContract;
}

export interface LedgerContainer {
  contract: LedgerPublicContract;
  /** Mounted at `/api/admin/drivers`, for `/admin/drivers/:id/wallet`. */
  buildAdminRouter: () => Router;
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

  const append = new AppendLedgerEntriesUseCase(repo);
  const balance = new GetWalletBalanceUseCase(repo);
  const wallet = new GetDriverWalletUseCase(repo, deps.settings);

  return {
    contract: {
      append: (entries) => append.execute(entries),
      walletBalance: (driverId) => balance.execute(driverId),
      lifetimeEarnings: (driverId) => repo.sumEarningsForDriver(driverId),
      entriesForBooking: (bookingId) => repo.listForBooking(bookingId),
      recentEntriesForDriver: (driverId, limit) => repo.listForDriver(driverId, limit),
    },
    buildAdminRouter: () => buildAdminRouter({ driverWallet: makeDriverWalletController(wallet) }),
    buildDriverRouter: () => buildDriverRouter({ myWallet: makeMyWalletController(wallet) }),
  };
}
