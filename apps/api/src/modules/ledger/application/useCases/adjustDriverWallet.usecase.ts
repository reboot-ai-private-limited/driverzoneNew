import { AppError } from '../../../../shared/errors/AppError.js';
import {
  validateEntry,
  type LedgerEntry,
  type NewLedgerEntry,
} from '../../domain/ledgerEntry.entity.js';
import type { LedgerRepositoryPort } from '../../domain/ledgerRepository.port.js';

export interface AdjustDriverWalletParams {
  driverId: string;
  type: 'ADJUSTMENT' | 'PENALTY' | 'BONUS';
  amountPaise: number;
  note: string;
}

export interface AdjustDriverWalletResult {
  entry: LedgerEntry;
  newBalancePaise: number;
}

export class AdjustDriverWalletUseCase {
  constructor(private readonly repo: LedgerRepositoryPort) {}

  async execute(params: AdjustDriverWalletParams): Promise<AdjustDriverWalletResult> {
    const newEntry: NewLedgerEntry = {
      driverId: params.driverId,
      entryType: params.type,
      amountPaise: params.amountPaise,
      note: params.note,
    };

    const problem = validateEntry(newEntry);
    if (problem !== null) {
      throw AppError.badRequest('VALIDATION_ERROR', { reason: problem });
    }

    const [written] = await this.repo.append([newEntry]);
    if (!written) {
      throw AppError.internal('INTERNAL', { reason: 'Failed to write ledger entry' });
    }

    const newBalancePaise = await this.repo.sumForDriver(params.driverId);

    return {
      entry: written,
      newBalancePaise,
    };
  }
}
