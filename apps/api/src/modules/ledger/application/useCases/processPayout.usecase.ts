import { AppError } from '../../../../shared/errors/AppError.js';
import type { LedgerRepositoryPort } from '../../domain/ledgerRepository.port.js';
import type { PayoutRepositoryPort } from '../../domain/payoutRepository.port.js';
import type { Payout } from '../../domain/payout.entity.js';
import type { LedgerEntry, NewLedgerEntry } from '../../domain/ledgerEntry.entity.js';

export interface ProcessPayoutParams {
  driverId: string;
  amountPaise?: number | undefined;
  utr?: string | undefined;
  notes?: string | undefined;
}

export interface ProcessPayoutResult {
  payout: Payout;
  ledgerEntry: LedgerEntry;
  newBalancePaise: number;
}

export class ProcessPayoutUseCase {
  constructor(
    private readonly ledgerRepo: LedgerRepositoryPort,
    private readonly payoutRepo: PayoutRepositoryPort,
  ) {}

  async execute(params: ProcessPayoutParams): Promise<ProcessPayoutResult> {
    const currentBalance = await this.ledgerRepo.sumForDriver(params.driverId);

    if (currentBalance <= 0) {
      throw AppError.badRequest('VALIDATION_FAILED', {
        reason: 'Driver has no positive balance available for payout',
        balancePaise: currentBalance,
      });
    }

    const payoutAmount = params.amountPaise ?? currentBalance;

    if (payoutAmount <= 0) {
      throw AppError.badRequest('VALIDATION_FAILED', {
        reason: 'Payout amount must be greater than zero',
      });
    }

    if (payoutAmount > currentBalance) {
      throw AppError.badRequest('VALIDATION_FAILED', {
        reason: 'Payout amount cannot exceed driver available balance',
        availableBalancePaise: currentBalance,
        requestedPaise: payoutAmount,
      });
    }

    // Record the payout entity
    const payout = await this.payoutRepo.create({
      driverId: params.driverId,
      amountPaise: payoutAmount,
      status: 'PAID',
      utr: params.utr ?? null,
      notes: params.notes ?? null,
      processedAt: new Date(),
    });

    // Debit the driver's ledger: PAYOUT entries are negative
    const ledgerEntryInput: NewLedgerEntry = {
      driverId: params.driverId,
      entryType: 'PAYOUT',
      amountPaise: -payoutAmount,
      payoutId: payout.id,
      note: params.notes ?? (params.utr ? `Payout (UTR: ${params.utr})` : 'Driver payout settlement'),
    };

    const [ledgerEntry] = await this.ledgerRepo.append([ledgerEntryInput]);
    if (!ledgerEntry) {
      throw AppError.internal('INTERNAL', {
        reason: 'Failed to debit driver ledger for payout',
      });
    }

    const newBalancePaise = await this.ledgerRepo.sumForDriver(params.driverId);

    return {
      payout,
      ledgerEntry,
      newBalancePaise,
    };
  }
}
