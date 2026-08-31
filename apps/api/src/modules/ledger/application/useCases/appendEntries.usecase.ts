import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import { validateEntry, type LedgerEntry, type NewLedgerEntry } from '../../domain/ledgerEntry.entity.js';
import type { LedgerRepositoryPort } from '../../domain/ledgerRepository.port.js';

/**
 * Writes a batch of ledger entries.
 *
 * ALL OR NOTHING ON VALIDATION, and permissive on replay. Those pull in opposite directions and
 * both are deliberate: a batch containing one malformed entry is a programming error and must not
 * half-write, while a batch that has already been written is a retry and must succeed quietly.
 *
 * The caller is the booking completion handler, running AFTER its transaction has committed —
 * side effects never run inside the transaction, because a failed ledger write must not roll back
 * a state change the driver has already been told about. That ordering is only safe because the
 * write is idempotent, which is what the unique partial index on the collection buys.
 */
export class AppendLedgerEntriesUseCase {
  constructor(private readonly repo: LedgerRepositoryPort) {}

  async execute(entries: readonly NewLedgerEntry[]): Promise<LedgerEntry[]> {
    const problems = entries
      .map((entry) => validateEntry(entry))
      .filter((message): message is string => message !== null);

    if (problems.length > 0) {
      // Not a bad request — no HTTP caller composes these. A malformed entry means the code that
      // built it is wrong, so it pages someone rather than being reported as user error.
      throw AppError.internal('INTERNAL', { reason: 'Invalid ledger entries', problems });
    }

    const written = await this.repo.append(entries);

    if (written.length < entries.length) {
      logger.info(
        { requested: entries.length, written: written.length },
        'ledger append skipped entries that already existed',
      );
    }

    return written;
  }
}
