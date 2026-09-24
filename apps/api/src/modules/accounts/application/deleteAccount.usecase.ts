import type { AccountDeletionBlocker, OtpChannel } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import type {
  AccountClosureContract,
  ClosableAccount,
  ClosableRole,
} from '../../identity/identity.public.js';
import type { BookingAccountContract } from '../../bookings/bookings.public.js';
import type { WalletReadContract } from '../../wallet/wallet.public.js';
import type { LedgerReadContract } from '../../ledger/ledger.public.js';
import { deletionBlockers, forfeitedCreditPaise, type DeletionFacts } from '../domain/deletionBlockers.js';

export interface DeletionPreview {
  blockers: AccountDeletionBlocker[];
  forfeitedCreditPaise: number;
}

function deletionBlocked(blockers: AccountDeletionBlocker[]): AppError {
  return new AppError({
    statusCode: 409,
    code: 'ACCOUNT_DELETION_BLOCKED',
    message: blockers[0]?.message ?? 'This account cannot be closed yet.',
    publicDetails: { reasons: blockers },
  });
}

/**
 * APPLICATION — close a customer or driver account, by three routes that share one set of rules.
 *
 *   - IN-APP: the signed-in user asks for a code to their own number, then confirms with it.
 *     Blockers are checked BEFORE the code is sent, so nobody waits for a text only to be told no.
 *   - PUBLIC: the web form, for someone who has uninstalled. Blockers are checked only AFTER the
 *     code is proven — checking them before would tell an anonymous caller "this number has an
 *     account and an open trip", which is the enumeration the OTP flow is built to prevent.
 *   - ADMIN: a SUPER_ADMIN closing an account on a request they have verified. No code.
 *
 * All three re-check the blockers immediately before erasing, because a trip can be booked
 * between the preview and the confirm.
 */
export class DeleteAccountUseCase {
  constructor(
    private readonly identity: AccountClosureContract,
    private readonly bookings: BookingAccountContract,
    private readonly wallet: Pick<WalletReadContract, 'balance'>,
    private readonly ledger: Pick<LedgerReadContract, 'walletBalance'>,
  ) {}

  // ─── In-app ─────────────────────────────────────────────────────────────────────────────

  async preview(role: ClosableRole, accountId: string): Promise<DeletionPreview> {
    const account = await this.mustFind(role, { id: accountId });
    const facts = await this.factsFor(role, account);
    return { blockers: deletionBlockers(facts), forfeitedCreditPaise: forfeitedCreditPaise(facts) };
  }

  async requestCode(
    role: ClosableRole,
    accountId: string,
    ip: string | undefined,
    channel: OtpChannel | undefined,
  ): Promise<{ expiresInSeconds: number; retryAfterSeconds: number }> {
    const account = await this.mustFind(role, { id: accountId });
    await this.assertClosable(role, account);
    return this.identity.sendClosureCode({ role, phone: account.mobileNumber, ip, channel });
  }

  async confirm(role: ClosableRole, accountId: string, code: string): Promise<void> {
    const account = await this.mustFind(role, { id: accountId });
    await this.identity.spendClosureCode(role, account.mobileNumber, code);
    await this.assertClosable(role, account);
    await this.identity.close(role, account.id, { type: 'SELF' });
  }

  // ─── Public web form ────────────────────────────────────────────────────────────────────

  /** Same answer whether or not the number has an account — identity's sender guarantees it. */
  requestCodeByPhone(
    role: ClosableRole,
    phone: string,
    ip: string | undefined,
    channel: OtpChannel | undefined,
  ): Promise<{ expiresInSeconds: number; retryAfterSeconds: number }> {
    return this.identity.sendClosureCode({ role, phone, ip, channel });
  }

  async confirmByPhone(role: ClosableRole, phone: string, code: string): Promise<void> {
    // The code first. Until it is proven, this caller learns nothing about the number.
    await this.identity.spendClosureCode(role, phone, code);

    // A correct code for a number with no account cannot happen — none was sent — but if it
    // somehow does, the safe answer is the same generic "not found" as any other.
    const account = await this.mustFind(role, { phone });
    await this.assertClosable(role, account);
    await this.identity.close(role, account.id, { type: 'SELF' });
  }

  // ─── Admin ──────────────────────────────────────────────────────────────────────────────

  async closeByAdmin(
    role: ClosableRole,
    accountId: string,
    actor: { adminId: string; ip?: string | undefined; reason: string },
  ): Promise<void> {
    const account = await this.mustFind(role, { id: accountId });
    await this.assertClosable(role, account);
    await this.identity.close(role, account.id, {
      type: 'ADMIN',
      adminId: actor.adminId,
      ip: actor.ip,
      reason: actor.reason,
    });
  }

  // ─── Shared ─────────────────────────────────────────────────────────────────────────────

  private async mustFind(
    role: ClosableRole,
    lookup: { id: string } | { phone: string },
  ): Promise<ClosableAccount> {
    const account = await this.identity.findClosable(role, lookup);
    if (account === undefined) throw AppError.notFound('Account not found.');
    return account;
  }

  private async assertClosable(role: ClosableRole, account: ClosableAccount): Promise<void> {
    const blockers = deletionBlockers(await this.factsFor(role, account));
    if (blockers.length > 0) throw deletionBlocked(blockers);
  }

  private async factsFor(role: ClosableRole, account: ClosableAccount): Promise<DeletionFacts> {
    const [hasOpenBooking, balancePaise] = await Promise.all([
      this.bookings.hasOpenBooking(role, account.id),
      role === 'CUSTOMER'
        ? this.wallet.balance(account.id)
        : this.ledger.walletBalance(account.id),
    ]);
    return { role, hasOpenBooking, isOnDuty: account.isOnDuty, balancePaise };
  }
}
