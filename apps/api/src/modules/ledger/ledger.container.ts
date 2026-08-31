import type { LedgerPublicContract } from './ledger.public.js';
import { MongoLedgerRepository } from './infrastructure/ledgerRepository.impl.js';
import { AppendLedgerEntriesUseCase } from './application/useCases/appendEntries.usecase.js';
import { GetWalletBalanceUseCase } from './application/useCases/getWalletBalance.usecase.js';

export interface LedgerContainer {
  contract: LedgerPublicContract;
}

/**
 * No router. The ledger has no HTTP surface of its own yet: the driver's earnings screen is a
 * mobile app that does not exist, and the admin statement view belongs to the `admin` module at
 * the top of the tier list. Adding endpoints now would mean guessing both shapes.
 */
export function buildLedgerContainer(): LedgerContainer {
  const repo = new MongoLedgerRepository();

  const append = new AppendLedgerEntriesUseCase(repo);
  const balance = new GetWalletBalanceUseCase(repo);

  return {
    contract: {
      append: (entries) => append.execute(entries),
      walletBalance: (driverId) => balance.execute(driverId),
      entriesForBooking: (bookingId) => repo.listForBooking(bookingId),
      recentEntriesForDriver: (driverId, limit) => repo.listForDriver(driverId, limit),
    },
  };
}
