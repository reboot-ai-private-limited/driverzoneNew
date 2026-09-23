import type { RequestHandler, Router } from 'express';
import type { AccountClosureContract, ClosableRole } from '../identity/identity.public.js';
import type { BookingAccountContract } from '../bookings/bookings.public.js';
import type { WalletReadContract } from '../wallet/wallet.public.js';
import type { LedgerReadContract } from '../ledger/ledger.public.js';
import { DeleteAccountUseCase } from './application/deleteAccount.usecase.js';
import {
  makeAdminDeletionController,
  makePublicDeletionControllers,
  makeSelfDeletionControllers,
} from './interface/accounts.controller.js';
import {
  buildAdminDeletionRouter,
  buildPublicDeletionRouter,
  buildSelfDeletionRouter,
} from './interface/accounts.routes.js';

/**
 * `accounts` — closing a customer or driver account.
 *
 * A module of its own, at the TOP of the graph, because deciding whether someone may leave needs
 * to see trips, the customer wallet and the driver ledger, and actually erasing them needs
 * identity. Nothing below may import this; it owns no collection — every row it touches belongs
 * to the module it asks.
 */
export interface AccountsDependencies {
  identity: AccountClosureContract;
  bookings: BookingAccountContract;
  wallet: Pick<WalletReadContract, 'balance'>;
  ledger: Pick<LedgerReadContract, 'walletBalance'>;
  /** Identity's SUPER_ADMIN guard. Only a super admin may close someone else's account. */
  requireSuperAdmin: RequestHandler;
}

export interface AccountsContainer {
  buildSelfRouter: (role: ClosableRole) => Router;
  buildPublicRouter: () => Router;
  buildAdminRouter: (role: ClosableRole) => Router;
}

export function buildAccountsContainer(deps: AccountsDependencies): AccountsContainer {
  const deletion = new DeleteAccountUseCase(deps.identity, deps.bookings, deps.wallet, deps.ledger);

  return {
    buildSelfRouter: (role) => buildSelfDeletionRouter(role, makeSelfDeletionControllers(role, deletion)),
    buildPublicRouter: () => buildPublicDeletionRouter(makePublicDeletionControllers(deletion)),
    buildAdminRouter: (role) =>
      buildAdminDeletionRouter(makeAdminDeletionController(role, deletion), deps.requireSuperAdmin),
  };
}
