import type { Router } from 'express';
import type { SettingsReadContract } from '../settings/settings.public.js';
import type { LedgerPublicContract } from './ledger.public.js';
import { MongoLedgerRepository } from './infrastructure/ledgerRepository.impl.js';
import { AppendLedgerEntriesUseCase } from './application/useCases/appendEntries.usecase.js';
import { GetWalletBalanceUseCase } from './application/useCases/getWalletBalance.usecase.js';
import { GetDriverWalletUseCase } from './application/useCases/getDriverWallet.usecase.js';
import { makeDriverWalletController } from './interface/ledger.controller.js';
import { buildAdminRouter } from './interface/ledger.routes.js';

export interface LedgerDependencies {
  /** For `driver.max_negative_balance` — the same figure dispatch filters on. */
  settings: SettingsReadContract;
}

export interface LedgerContainer {
  contract: LedgerPublicContract;
  /** Mounted at `/api/admin/drivers`. The driver's earnings screen is a mobile app, still absent. */
  buildAdminRouter: () => Router;
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
  };
}
