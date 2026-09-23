import type { StoragePort } from '@/shared/storage/storage.port.js';
import { logger } from '@/shared/logging/logger.js';
import type { AccountEraserPort, ErasedAccount } from '../../domain/accountEraser.port.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type { SessionRepositoryPort } from '../../domain/session.repository.port.js';

export type ClosableRole = 'CUSTOMER' | 'DRIVER';

/** Who closed it. Self-service closures have no admin to attribute an audit row to. */
export type ClosedBy =
  | { type: 'SELF' }
  | { type: 'ADMIN'; adminId: string; ip?: string | undefined; reason?: string | undefined };

/**
 * APPLICATION — the identity half of closing an account: erase, remove the files, sign out.
 *
 * WHETHER the account may close — open trips, money owed — is not decided here. Identity is tier 1
 * and cannot see bookings, the wallet or the ledger; the `accounts` module above it asks those
 * questions first and only then calls this.
 *
 * Order matters. The erase is one conditional write and is the point of no return; everything
 * after it is cleanup that must not be able to undo it. A storage outage leaves orphaned files
 * (logged, for someone to sweep) rather than a half-deleted person who can still sign in.
 */
export class CloseAccountUseCase {
  constructor(
    private readonly eraser: AccountEraserPort,
    private readonly sessions: SessionRepositoryPort,
    private readonly storage: Pick<StoragePort, 'deleteFile'>,
    private readonly audit: AuditPort,
  ) {}

  /** Resolves `false` if there was nothing to close — already deleted, or never existed. */
  async execute(role: ClosableRole, accountId: string, by: ClosedBy): Promise<boolean> {
    const now = new Date();

    const erased =
      role === 'CUSTOMER'
        ? await this.eraser.eraseCustomer(accountId, now)
        : await this.eraser.eraseDriver(accountId, now);

    if (erased === undefined) return false;

    await this.sessions.revokeAllForUser(accountId, role, now);
    await this.removeFiles(role, accountId, erased);

    if (by.type === 'ADMIN') {
      await this.audit.record({
        adminId: by.adminId,
        entityType: role === 'CUSTOMER' ? 'Customer' : 'Driver',
        entityId: accountId,
        action: 'DELETE',
        after: { deletedAt: now.toISOString(), reason: by.reason ?? null },
        ip: by.ip,
      });
    }

    // No phone and no name: the log line must not re-create the personal data just erased.
    logger.info({ role, accountId, by: by.type }, 'account closed and personal data erased');
    return true;
  }

  private async removeFiles(role: ClosableRole, accountId: string, erased: ErasedAccount): Promise<void> {
    const files = [
      ...erased.privateFileKeys.map((key) => ({ key, isPrivate: true })),
      ...erased.publicFileKeys.map((key) => ({ key, isPrivate: false })),
    ];

    const results = await Promise.allSettled(
      files.map((file) => this.storage.deleteFile(file.key, file.isPrivate)),
    );

    const failed = files.filter((_, i) => results[i]?.status === 'rejected').map((file) => file.key);
    if (failed.length > 0) {
      logger.error(
        { role, accountId, failedKeys: failed },
        'account closed but some files could not be removed from storage — remove them by hand',
      );
    }
  }
}
