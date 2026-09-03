import type { Router } from 'express';
import { ManageWalletUseCase } from './application/useCases/manageWallet.usecase.js';
import { MongoWalletRepository } from './infrastructure/walletRepository.impl.js';
import {
  makeAdminGetWalletController,
  makeAdminGrantWalletController,
  makeGetMyWalletController,
} from './interface/wallet.controller.js';
import { buildAdminRouter, buildCustomerRouter } from './interface/wallet.routes.js';
import type { WalletPublicContract } from './wallet.public.js';

export interface WalletContainer {
  contract: WalletPublicContract;
  /** Mounted at `/api/customer/wallet`. */
  buildCustomerRouter: () => Router;
  /** Mounted at `/api/admin/customers`, after identity's admin router. */
  buildAdminRouter: () => Router;
}

/**
 * Takes no dependencies, and that is worth noticing: a wallet is rows and their sum, with no
 * settings to read and no other module to ask. It sits on tier 2 beside `ledger` and `payments`
 * for the same reason they do — everything above it needs it, and it needs nothing above.
 */
export function buildWalletContainer(): WalletContainer {
  const wallet = new ManageWalletUseCase(new MongoWalletRepository());

  return {
    contract: {
      append: (entries) => wallet.append(entries),
      balance: (customerId) => wallet.balance(customerId),
      planFor: (customerId, farePaise) => wallet.planFor(customerId, farePaise),
      entriesForBooking: (bookingId) => wallet.entriesForBooking(bookingId),
    },
    buildCustomerRouter: () =>
      buildCustomerRouter({ myWallet: makeGetMyWalletController(wallet) }),
    buildAdminRouter: () =>
      buildAdminRouter({
        get: makeAdminGetWalletController(wallet),
        grant: makeAdminGrantWalletController(wallet),
      }),
  };
}
