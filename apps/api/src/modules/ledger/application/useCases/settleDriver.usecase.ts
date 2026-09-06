import { AppError } from '../../../../shared/errors/AppError.js';
import type { LedgerEntry } from '../../domain/ledgerEntry.entity.js';
import type { LedgerRepositoryPort } from '../../domain/ledgerRepository.port.js';

export interface SettleDriverInput {
  driverId: string;
  /** A POSITIVE magnitude. The direction is this use case's to decide, never the caller's. */
  amountPaise: number;
  /** Mandatory. A money row nobody can explain later is a money row nobody can audit. */
  note: string;
  /** A UTR, receipt number or similar. */
  reference?: string | undefined;
  /**
   * Makes a double-tapped Settle button clear a balance once.
   *
   * Required, not optional. Every other guard here refuses a bad request; this one refuses a
   * DUPLICATE of a good one, which is the failure that actually happens — a slow response, an
   * impatient second click, and a driver credited twice in a ledger that cannot be edited.
   */
  idempotencyKey: string;
}

export interface SettlementResult {
  entry: LedgerEntry;
  balanceBeforePaise: number;
  balanceAfterPaise: number;
}

/**
 * Records that a driver's balance was cleared, in whichever direction it was standing.
 *
 * THE DIRECTION IS DERIVED, NOT SUPPLIED. A negative balance means the driver is holding company
 * cash and is paying it back — that is a `DEBT_COLLECTED` (positive). A positive balance means the
 * company owes them and is paying out — a `PAYOUT` (negative). A client that could choose would
 * eventually choose wrong, and the wrong choice is a permanent row asserting money moved the way
 * it did not.
 *
 * THE BALANCE IS RECOMPUTED HERE, at the moment of the write. Whatever the client believed the
 * balance was when it rendered the dialog is a suggestion — someone may have completed a trip in
 * between — so the cap is applied against the real figure, not the one that came in.
 *
 * WHAT THIS CANNOT DO IS UNDO. The ledger is append-only by construction; the port has no update
 * and no delete. A settlement entered wrongly can only be annotated with an `ADJUSTMENT`, which
 * is why this refuses more than it accepts.
 */
export class SettleDriverUseCase {
  constructor(private readonly repo: LedgerRepositoryPort) {}

  async execute(input: SettleDriverInput): Promise<SettlementResult> {
    if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw AppError.badRequest('The settlement amount must be a positive number of paise.');
    }

    if (input.note.trim() === '') {
      throw AppError.badRequest('A settlement needs a note saying what it was.');
    }

    /*
     * A REPLAY RETURNS THE ORIGINAL, it does not fail. The unique partial index on
     * `idempotencyKey` is the race guard; this is the ordinary path — the same request arriving
     * twice reports the same settlement, so a client that retried a timeout sees success rather
     * than a conflict it has to interpret.
     */
    const existing = await this.repo.findByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) {
      const balanceAfterPaise = await this.repo.sumForDriver(existing.driverId);
      return {
        entry: existing,
        balanceBeforePaise: balanceAfterPaise - existing.amountPaise,
        balanceAfterPaise,
      };
    }

    const balanceBeforePaise = await this.repo.sumForDriver(input.driverId);

    if (balanceBeforePaise === 0) {
      // Not a silent no-op: a zero-value row would sit in the statement forever explaining
      // nothing, and the caller almost certainly meant a different driver.
      throw AppError.badRequest('This driver is already settled — there is nothing to clear.');
    }

    const outstandingPaise = Math.abs(balanceBeforePaise);
    if (input.amountPaise > outstandingPaise) {
      throw AppError.badRequest(
        `That is more than the outstanding balance. At most ${outstandingPaise} paise can be settled.`,
      );
    }

    /*
     * Negative balance → the driver is repaying us, so the row is POSITIVE and moves the balance
     * up toward zero. Positive balance → we are paying them, so the row is NEGATIVE and moves it
     * down toward zero. Both discharge; the sign follows from which side was standing.
     */
    const repaying = balanceBeforePaise < 0;
    const [entry] = await this.repo.append([
      {
        driverId: input.driverId,
        bookingId: null,
        entryType: repaying ? 'DEBT_COLLECTED' : 'PAYOUT',
        amountPaise: repaying ? input.amountPaise : -input.amountPaise,
        note:
          input.reference === undefined || input.reference.trim() === ''
            ? input.note.trim()
            : `${input.note.trim()} (ref: ${input.reference.trim()})`,
        idempotencyKey: input.idempotencyKey,
      },
    ]);

    if (entry === undefined) {
      // `append` returns only rows actually written. Nothing here is once-per-booking, so an
      // empty result means the insert genuinely failed rather than being deduplicated.
      throw AppError.internal('INTERNAL', { reason: 'the settlement row was not written' });
    }

    return {
      entry,
      balanceBeforePaise,
      balanceAfterPaise: balanceBeforePaise + entry.amountPaise,
    };
  }
}
