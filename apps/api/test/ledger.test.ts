import { describe, expect, it, vi } from 'vitest';
import { AppendLedgerEntriesUseCase } from '../src/modules/ledger/application/useCases/appendEntries.usecase.js';
import { GetWalletBalanceUseCase } from '../src/modules/ledger/application/useCases/getWalletBalance.usecase.js';
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
