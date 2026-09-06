import { describe, expect, it, vi } from 'vitest';
import { AppendLedgerEntriesUseCase } from '../src/modules/ledger/application/useCases/appendEntries.usecase.js';
import { GetWalletBalanceUseCase } from '../src/modules/ledger/application/useCases/getWalletBalance.usecase.js';
import { SettleDriverUseCase } from '../src/modules/ledger/application/useCases/settleDriver.usecase.js';
import { GetDriverBalancesUseCase } from '../src/modules/ledger/application/useCases/getDriverBalances.usecase.js';
import { GetDriverWalletUseCase } from '../src/modules/ledger/application/useCases/getDriverWallet.usecase.js';
import { toWalletDto } from '../src/modules/ledger/interface/ledger.mapper.js';
import {
  validateEntry,
  type LedgerEntry,
  type NewLedgerEntry,
} from '../src/modules/ledger/domain/ledgerEntry.entity.js';
import type { LedgerRepositoryPort } from '../src/modules/ledger/domain/ledgerRepository.port.js';

/**
 * The duplicate-key path in `MongoLedgerRepository` needs a real index to exercise, so it lives
 * in the integration suite. What is here is the validation and the use-case contract around it.
 */

function fakeRepo(overrides: Partial<LedgerRepositoryPort> = {}): LedgerRepositoryPort {
  const store: LedgerEntry[] = [];
  return {
    append: vi.fn(async (entries: readonly NewLedgerEntry[]) => {
      const written = entries.map((entry, index) => ({
        id: `led_${store.length + index}`,
        driverId: entry.driverId,
        bookingId: entry.bookingId ?? null,
        entryType: entry.entryType,
        amountPaise: entry.amountPaise,
        note: entry.note ?? null,
        payoutId: null,
        createdAt: new Date(),
      }));
      store.push(...written);
      return written;
    }),
    sumForDriver: vi.fn(async () => store.reduce((sum, e) => sum + e.amountPaise, 0)),
    listForDriver: vi.fn(async () => store),
    listForBooking: vi.fn(async () => store),
    ...overrides,
  };
}

const tripEarning: NewLedgerEntry = {
  driverId: 'drv_1',
  bookingId: 'bkg_1',
  entryType: 'TRIP_EARNING',
  amountPaise: 75_000,
};

describe('validateEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(validateEntry(tripEarning)).toBeNull();
  });

  it('refuses a positive CASH_COLLECTED — that would pay a driver for money they hold', () => {
    expect(
      validateEntry({ ...tripEarning, entryType: 'CASH_COLLECTED', amountPaise: 105_000 }),
    ).toMatch(/must not be positive/);
  });

  it('refuses a negative TRIP_EARNING', () => {
    expect(validateEntry({ ...tripEarning, amountPaise: -1 })).toMatch(/must not be negative/);
  });

  it('refuses a fractional amount', () => {
    expect(validateEntry({ ...tripEarning, amountPaise: 75_000.5 })).toMatch(/integer/);
  });

  it('requires a note on an ADJUSTMENT and on a PENALTY', () => {
    expect(
      validateEntry({ ...tripEarning, entryType: 'ADJUSTMENT', amountPaise: -100 }),
    ).toMatch(/requires a note/);
    expect(
      validateEntry({ ...tripEarning, entryType: 'PENALTY', amountPaise: -5_000 }),
    ).toMatch(/requires a note/);
    expect(
      validateEntry({
        ...tripEarning,
        entryType: 'PENALTY',
        amountPaise: -5_000,
        note: 'Arrived 24 minutes late',
      }),
    ).toBeNull();
  });

  it('allows either sign on an ADJUSTMENT', () => {
    const note = 'Support credit, ticket 4182';
    expect(validateEntry({ ...tripEarning, entryType: 'ADJUSTMENT', amountPaise: 500, note })).toBeNull();
    expect(validateEntry({ ...tripEarning, entryType: 'ADJUSTMENT', amountPaise: -500, note })).toBeNull();
  });
});

describe('AppendLedgerEntriesUseCase', () => {
  it('writes a well-formed batch', async () => {
    const repo = fakeRepo();
    const written = await new AppendLedgerEntriesUseCase(repo).execute([
      tripEarning,
      { driverId: 'drv_1', bookingId: 'bkg_1', entryType: 'CASH_COLLECTED', amountPaise: -105_000 },
    ]);

    expect(written).toHaveLength(2);
    expect(repo.append).toHaveBeenCalledOnce();
  });

  it('writes nothing at all when any entry in the batch is malformed', async () => {
    const repo = fakeRepo();
    const useCase = new AppendLedgerEntriesUseCase(repo);

    await expect(
      useCase.execute([tripEarning, { ...tripEarning, entryType: 'PENALTY', amountPaise: -50 }]),
    ).rejects.toThrow();

    expect(repo.append).not.toHaveBeenCalled();
  });

  it('treats an already-written batch as success, not as a conflict', async () => {
    // What a retried trip completion looks like: the index rejected every row as a duplicate.
    const repo = fakeRepo({ append: vi.fn(async () => []) });
    await expect(new AppendLedgerEntriesUseCase(repo).execute([tripEarning])).resolves.toEqual([]);
  });

  it('does nothing for an empty batch', async () => {
    const repo = fakeRepo();
    await expect(new AppendLedgerEntriesUseCase(repo).execute([])).resolves.toEqual([]);
  });
});

describe('GetWalletBalanceUseCase', () => {
  it('reports the cash-fare driver as owing the company', async () => {
    // ₹1,050 trip, ₹750 driver share, paid in cash: the driver holds ₹1,050 and earned ₹750,
    // so they owe ₹300. This is the worked example from docs/LLD/pricing-and-commission.md.
    const repo = fakeRepo();
    await new AppendLedgerEntriesUseCase(repo).execute([
      { driverId: 'drv_1', bookingId: 'bkg_1', entryType: 'TRIP_EARNING', amountPaise: 75_000 },
      { driverId: 'drv_1', bookingId: 'bkg_1', entryType: 'CASH_COLLECTED', amountPaise: -105_000 },
    ]);

    expect(await new GetWalletBalanceUseCase(repo).execute('drv_1')).toBe(-30_000);
  });

  it('reports the online-fare driver as owed their share', async () => {
    const repo = fakeRepo();
    await new AppendLedgerEntriesUseCase(repo).execute([
      { driverId: 'drv_1', bookingId: 'bkg_2', entryType: 'TRIP_EARNING', amountPaise: 75_000 },
    ]);

    expect(await new GetWalletBalanceUseCase(repo).execute('drv_1')).toBe(75_000);
  });

  it('credits waiting time in full, uncommissioned', async () => {
    const repo = fakeRepo();
    await new AppendLedgerEntriesUseCase(repo).execute([
      { driverId: 'drv_1', bookingId: 'bkg_3', entryType: 'TRIP_EARNING', amountPaise: 75_000 },
      { driverId: 'drv_1', bookingId: 'bkg_3', entryType: 'WAITING_EARNING', amountPaise: 5_000 },
    ]);

    // The customer paid ₹50 of waiting and the driver receives all ₹50 of it.
    expect(await new GetWalletBalanceUseCase(repo).execute('drv_1')).toBe(80_000);
  });
});

// ─── The statement, and its filters ─────────────────────────────────────────────────────────

/**
 * The wallet read behind both `GET /driver/wallet` and `GET /admin/drivers/:id/wallet`.
 *
 * What is worth pinning here is the SEAM the filters introduced: the running balance is now the
 * repository's to compute, and the wallet headline must not move when the statement is filtered.
 * The aggregation itself needs a real Mongo and lives in the integration suite.
 */
function walletRepo(
  rows: Array<{ entry: LedgerEntry; balanceAfterPaise: number }>,
  totals: { creditedPaise: number; debitedPaise: number; count: number },
): LedgerRepositoryPort {
  return fakeRepo({
    sumForDriver: vi.fn(async () => -30_000),
    sumEarningsForDriver: vi.fn(async () => 80_000),
    pageForDriver: vi.fn(async () => ({ entries: rows, totalItems: totals.count })),
    totalsForDriver: vi.fn(async () => totals),
  } as Partial<LedgerRepositoryPort>);
}

/** Only `driver.max_negative_balance` is read here; the rest of the snapshot is not this test's. */
const fakeSettings = {
  snapshot: vi.fn(async () => ({ 'driver.max_negative_balance': 500 })),
} as unknown as ConstructorParameters<typeof GetDriverWalletUseCase>[1];

function buildWallet(repo: LedgerRepositoryPort): GetDriverWalletUseCase {
  return new GetDriverWalletUseCase(repo, fakeSettings);
}

function row(
  id: string,
  entryType: LedgerEntry['entryType'],
  amountPaise: number,
  balanceAfterPaise: number,
): { entry: LedgerEntry; balanceAfterPaise: number } {
  return {
    entry: {
      id,
      driverId: 'drv_1',
      bookingId: null,
      entryType,
      amountPaise,
      note: null,
      payoutId: null,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    },
    balanceAfterPaise,
  };
}

describe('GetDriverWalletUseCase', () => {
  it('passes the filter to the statement reads and to nothing else', async () => {
    const repo = walletRepo([], { creditedPaise: 0, debitedPaise: 0, count: 0 });
    const query = { types: ['PAYOUT'] as const };

    await buildWallet(repo).execute('drv_1', 1, 10, query);

    expect(repo.pageForDriver).toHaveBeenCalledWith('drv_1', 1, 10, query);
    expect(repo.totalsForDriver).toHaveBeenCalledWith('drv_1', query);
    // The balance and lifetime figures are facts about the DRIVER, not about the filtered rows.
    expect(repo.sumForDriver).toHaveBeenCalledWith('drv_1');
    expect(repo.sumEarningsForDriver).toHaveBeenCalledWith('drv_1');
  });

  it('leaves the wallet headline untouched by a filter', async () => {
    const repo = walletRepo([], { creditedPaise: 0, debitedPaise: 0, count: 0 });

    const wallet = await buildWallet(repo).execute('drv_1', 1, 10, {
      types: ['BONUS'],
    });

    // A driver filtering to bonuses has not stopped owing the cash they collected yesterday.
    expect(wallet.balancePaise).toBe(-30_000);
    expect(wallet.lifetimeEarningsPaise).toBe(80_000);
  });
});

describe('toWalletDto', () => {
  it('takes each row’s balance from the repository rather than walking it back', async () => {
    /*
     * Non-consecutive rows on purpose — a filtered page. Walking back would make the second row
     * `12_000 - 5_000 = 7_000`; the real balance after it was 2_000, because rows the filter
     * excluded sat between them. This is the bug the window sum exists to prevent.
     */
    const repo = walletRepo(
      [row('led_2', 'BONUS', 5_000, 12_000), row('led_1', 'BONUS', 1_000, 2_000)],
      { creditedPaise: 6_000, debitedPaise: 0, count: 2 },
    );

    const wallet = await buildWallet(repo).execute('drv_1', 1, 10, {
      types: ['BONUS'],
    });
    const dto = toWalletDto('drv_1', wallet, 1, 10);

    expect(dto.ledger.map((entry) => entry.balance_after_paise)).toEqual([12_000, 2_000]);
  });

  it('reports credited, debited and net for the whole selection', async () => {
    const repo = walletRepo([], { creditedPaise: 80_000, debitedPaise: 110_000, count: 7 });

    const wallet = await buildWallet(repo).execute('drv_1', 1, 10);
    const dto = toWalletDto('drv_1', wallet, 1, 10);

    expect(dto.summary).toEqual({
      credited_paise: 80_000,
      debited_paise: 110_000,
      // Signed, and negative here: this driver took more cash than they earned over the selection.
      net_paise: -30_000,
      count: 7,
    });
  });
});

// ─── GetDriverBalancesUseCase ───────────────────────────────────────────────────────────────

function balanceRow(driverId: string, balancePaise: number) {
  return {
    driverId,
    balancePaise,
    lifetimeEarningsPaise: Math.max(balancePaise, 0),
    entryCount: 3,
    lastEntryAt: new Date('2026-09-04T10:00:00.000Z'),
  };
}

const EMPTY_AGGREGATE = {
  driversInDebt: 0,
  totalOwedToCompanyPaise: 0,
  driversInCredit: 0,
  totalPayableToDriversPaise: 0,
  suspendedCount: 0,
  drivers: 0,
};

function balancesRepo(rows: ReturnType<typeof balanceRow>[]): LedgerRepositoryPort {
  return fakeRepo({
    pageDriverBalances: vi.fn(async () => ({
      rows,
      totals: { ...EMPTY_AGGREGATE, drivers: rows.length },
      totalItems: rows.length,
    })),
  } as Partial<LedgerRepositoryPort>);
}

describe('GetDriverBalancesUseCase', () => {
  /*
   * `fakeSettings` reports `driver.max_negative_balance: 500` rupees — 50,000 paise. These cases
   * sit either side of that boundary deliberately: it is the same number dispatch filters on, so
   * getting it wrong means the finance screen and the dispatcher disagree about who is working.
   */
  function build(repo: LedgerRepositoryPort) {
    return new GetDriverBalancesUseCase(repo, fakeSettings);
  }

  it('flags a driver past the threshold as suspended', async () => {
    const repo = balancesRepo([balanceRow('drv_1', -50_001)]);
    const result = await build(repo).execute({}, 1, 20);

    expect(result.rows[0]?.isSuspendedForBalance).toBe(true);
  });

  it('does NOT flag a driver exactly at the threshold', async () => {
    // The rule is `balance < -threshold`, not `<=`. A driver owing exactly the cap is still
    // allowed to work, and dispatch's `$gte: -max` agrees — this asserts the two stay aligned.
    const repo = balancesRepo([balanceRow('drv_1', -50_000)]);
    const result = await build(repo).execute({}, 1, 20);

    expect(result.rows[0]?.isSuspendedForBalance).toBe(false);
  });

  it('never flags a driver the company owes money to', async () => {
    const repo = balancesRepo([balanceRow('drv_1', 250_000)]);
    const result = await build(repo).execute({}, 1, 20);

    expect(result.rows[0]?.isSuspendedForBalance).toBe(false);
  });

  it('resolves the threshold from settings and hands it to the repository', async () => {
    // The repository counts suspended drivers across every page, which it can only do if it is
    // given the number — computing it here would only ever see the page.
    const repo = balancesRepo([]);
    await build(repo).execute({ state: 'OWED_TO_COMPANY' }, 2, 25);

    expect(repo.pageDriverBalances).toHaveBeenCalledWith(
      { state: 'OWED_TO_COMPANY', suspendedThresholdPaise: 50_000 },
      2,
      25,
    );
  });

  it('passes the totals through untouched', async () => {
    // They describe every driver the filter selects, not the page, so the use case must not
    // recompute them from `rows` — which is exactly what it would be tempting to do.
    const repo = fakeRepo({
      pageDriverBalances: vi.fn(async () => ({
        rows: [balanceRow('drv_1', -116_400)],
        totals: { ...EMPTY_AGGREGATE, driversInDebt: 41, totalOwedToCompanyPaise: 900_000, drivers: 60 },
        totalItems: 60,
      })),
    } as Partial<LedgerRepositoryPort>);

    const result = await build(repo).execute({}, 1, 1);

    expect(result.totals.driversInDebt).toBe(41);
    expect(result.totals.totalOwedToCompanyPaise).toBe(900_000);
    expect(result.totalItems).toBe(60);
  });
});

// ─── SettleDriverUseCase ────────────────────────────────────────────────────────────────────

function settleRepo(balancePaise: number, existing: LedgerEntry | null = null): LedgerRepositoryPort {
  return fakeRepo({
    sumForDriver: vi.fn(async () => balancePaise),
    findByIdempotencyKey: vi.fn(async () => existing),
  } as Partial<LedgerRepositoryPort>);
}

const SETTLE_BASE = { driverId: 'drv_1', note: 'Cash handed in at the office', idempotencyKey: 'key_1' };

describe('SettleDriverUseCase', () => {
  it('writes DEBT_COLLECTED (positive) when the driver owes the company', async () => {
    /*
     * The direction is derived from the balance, never sent by the client. A driver at −₹1,164 is
     * holding company cash; paying it back RAISES their balance toward zero, so the row must be
     * positive. Getting this backwards would double their debt while claiming to clear it.
     */
    const repo = settleRepo(-116_400);
    const result = await new SettleDriverUseCase(repo).execute({ ...SETTLE_BASE, amountPaise: 116_400 });

    expect(result.entry.entryType).toBe('DEBT_COLLECTED');
    expect(result.entry.amountPaise).toBe(116_400);
    expect(result.balanceAfterPaise).toBe(0);
  });

  it('writes PAYOUT (negative) when the company owes the driver', async () => {
    const repo = settleRepo(50_000);
    const result = await new SettleDriverUseCase(repo).execute({ ...SETTLE_BASE, amountPaise: 50_000 });

    expect(result.entry.entryType).toBe('PAYOUT');
    expect(result.entry.amountPaise).toBe(-50_000);
    expect(result.balanceAfterPaise).toBe(0);
  });

  it('allows a partial settlement and leaves the rest outstanding', async () => {
    const repo = settleRepo(-116_400);
    const result = await new SettleDriverUseCase(repo).execute({ ...SETTLE_BASE, amountPaise: 16_400 });

    expect(result.balanceAfterPaise).toBe(-100_000);
  });

  it('refuses more than the outstanding balance', async () => {
    // The client's figure is a suggestion — a trip may have completed since the dialog rendered —
    // so the cap is applied against the balance recomputed here, not the one that came in.
    const repo = settleRepo(-10_000);
    await expect(
      new SettleDriverUseCase(repo).execute({ ...SETTLE_BASE, amountPaise: 10_001 }),
    ).rejects.toThrow(/more than the outstanding balance/);
  });

  it('refuses to settle a driver who is already square', async () => {
    // Not a silent no-op: a zero-value row would explain nothing forever, in a ledger nobody can
    // edit, and the caller almost certainly meant a different driver.
    const repo = settleRepo(0);
    await expect(
      new SettleDriverUseCase(repo).execute({ ...SETTLE_BASE, amountPaise: 100 }),
    ).rejects.toThrow(/already settled/);
  });

  it.each([0, -500, 1.5])('refuses a %s amount', async (amountPaise) => {
    const repo = settleRepo(-116_400);
    await expect(
      new SettleDriverUseCase(repo).execute({ ...SETTLE_BASE, amountPaise }),
    ).rejects.toThrow(/positive number of paise/);
  });

  it('refuses a blank note', async () => {
    const repo = settleRepo(-116_400);
    await expect(
      new SettleDriverUseCase(repo).execute({ ...SETTLE_BASE, note: '   ', amountPaise: 100 }),
    ).rejects.toThrow(/needs a note/);
  });

  it('appends the reference into the note when one is given', async () => {
    const repo = settleRepo(-116_400);
    await new SettleDriverUseCase(repo).execute({
      ...SETTLE_BASE,
      amountPaise: 100,
      reference: 'UTR123',
    });

    expect(repo.append).toHaveBeenCalledWith([
      expect.objectContaining({ note: 'Cash handed in at the office (ref: UTR123)' }),
    ]);
  });

  it('REPLAYS: the same idempotency key returns the original row and writes nothing', async () => {
    /*
     * The failure this exists for is a slow response and an impatient second click. The ledger is
     * append-only, so a double write cannot be taken back — only annotated.
     */
    const original: LedgerEntry = {
      id: 'led_settle',
      driverId: 'drv_1',
      bookingId: null,
      entryType: 'DEBT_COLLECTED',
      amountPaise: 116_400,
      note: 'Cash handed in at the office',
      payoutId: null,
      idempotencyKey: 'key_1',
      createdAt: new Date('2026-09-05T10:00:00.000Z'),
    };
    const repo = settleRepo(0, original);

    const result = await new SettleDriverUseCase(repo).execute({ ...SETTLE_BASE, amountPaise: 116_400 });

    expect(result.entry.id).toBe('led_settle');
    expect(repo.append).not.toHaveBeenCalled();
    // Balance either side is reconstructed from the row, so a replay reports the same movement.
    expect(result.balanceBeforePaise).toBe(-116_400);
    expect(result.balanceAfterPaise).toBe(0);
  });

  it('carries the idempotency key onto the row it writes', async () => {
    const repo = settleRepo(-116_400);
    await new SettleDriverUseCase(repo).execute({ ...SETTLE_BASE, amountPaise: 100 });

    expect(repo.append).toHaveBeenCalledWith([expect.objectContaining({ idempotencyKey: 'key_1' })]);
  });
});
