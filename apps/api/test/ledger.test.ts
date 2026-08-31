import { describe, expect, it, vi } from 'vitest';
import { AppendLedgerEntriesUseCase } from '../src/modules/ledger/application/useCases/appendEntries.usecase.js';
import { GetWalletBalanceUseCase } from '../src/modules/ledger/application/useCases/getWalletBalance.usecase.js';
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
