import { describe, expect, it, vi } from 'vitest';
import { AppendLedgerEntriesUseCase } from '../src/modules/ledger/application/useCases/appendEntries.usecase.js';
import { GetWalletBalanceUseCase } from '../src/modules/ledger/application/useCases/getWalletBalance.usecase.js';
import { AdjustDriverWalletUseCase } from '../src/modules/ledger/application/useCases/adjustDriverWallet.usecase.js';
import { ProcessPayoutUseCase } from '../src/modules/ledger/application/useCases/processPayout.usecase.js';
import { ListPayoutsUseCase } from '../src/modules/ledger/application/useCases/listPayouts.usecase.js';
import {
  validateEntry,
  type LedgerEntry,
  type NewLedgerEntry,
} from '../src/modules/ledger/domain/ledgerEntry.entity.js';
import type { LedgerRepositoryPort } from '../src/modules/ledger/domain/ledgerRepository.port.js';
import type { PayoutRepositoryPort } from '../src/modules/ledger/domain/payoutRepository.port.js';
import type { Payout } from '../src/modules/ledger/domain/payout.entity.js';

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

function fakePayoutRepo(overrides: Partial<PayoutRepositoryPort> = {}): PayoutRepositoryPort {
  const store: Payout[] = [];
  return {
    create: vi.fn(async (payout) => {
      const created: Payout = {
        id: `pay_${store.length + 1}`,
        driverId: payout.driverId,
        amountPaise: payout.amountPaise,
        status: payout.status ?? 'PAID',
        utr: payout.utr ?? null,
        notes: payout.notes ?? null,
        createdAt: new Date(),
        processedAt: payout.processedAt ?? new Date(),
      };
      store.push(created);
      return created;
    }),
    findById: vi.fn(async (id) => store.find((p) => p.id === id) ?? null),
    listPaginated: vi.fn(async (_filter, page, limit) => ({
      payouts: store.slice((page - 1) * limit, page * limit),
      totalItems: store.length,
    })),
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

describe('AdjustDriverWalletUseCase', () => {
  it('applies an ADJUSTMENT successfully and returns the entry with updated balance', async () => {
    const repo = fakeRepo();
    const useCase = new AdjustDriverWalletUseCase(repo);

    const result = await useCase.execute({
      driverId: 'drv_1',
      type: 'ADJUSTMENT',
      amountPaise: 50_000,
      note: 'Manual goodwill adjustment',
    });

    expect(result.entry.entryType).toBe('ADJUSTMENT');
    expect(result.entry.amountPaise).toBe(50_000);
    expect(result.entry.note).toBe('Manual goodwill adjustment');
    expect(result.newBalancePaise).toBe(50_000);
  });

  it('applies a negative PENALTY and updates balance', async () => {
    const repo = fakeRepo();
    const useCase = new AdjustDriverWalletUseCase(repo);

    const result = await useCase.execute({
      driverId: 'drv_1',
      type: 'PENALTY',
      amountPaise: -15_000,
      note: 'Late cancellation penalty',
    });

    expect(result.entry.entryType).toBe('PENALTY');
    expect(result.entry.amountPaise).toBe(-15_000);
    expect(result.newBalancePaise).toBe(-15_000);
  });

  it('applies a positive BONUS and updates balance', async () => {
    const repo = fakeRepo();
    const useCase = new AdjustDriverWalletUseCase(repo);

    const result = await useCase.execute({
      driverId: 'drv_1',
      type: 'BONUS',
      amountPaise: 20_000,
      note: 'Weekly performance incentive',
    });

    expect(result.entry.entryType).toBe('BONUS');
    expect(result.entry.amountPaise).toBe(20_000);
    expect(result.newBalancePaise).toBe(20_000);
  });

  it('rejects an invalid adjustment entry (e.g. PENALTY with positive amount)', async () => {
    const repo = fakeRepo();
    const useCase = new AdjustDriverWalletUseCase(repo);

    await expect(
      useCase.execute({
        driverId: 'drv_1',
        type: 'PENALTY',
        amountPaise: 10_000,
        note: 'Invalid positive penalty',
      }),
    ).rejects.toThrow();
  });
});

describe('ProcessPayoutUseCase', () => {
  it('disburses a full payout when no specific amount is requested', async () => {
    const ledgerRepo = fakeRepo();
    const payoutRepo = fakePayoutRepo();

    // Driver has ₹1,000 credit
    await new AppendLedgerEntriesUseCase(ledgerRepo).execute([
      { driverId: 'drv_1', bookingId: 'bkg_1', entryType: 'TRIP_EARNING', amountPaise: 100_000 },
    ]);

    const useCase = new ProcessPayoutUseCase(ledgerRepo, payoutRepo);
    const result = await useCase.execute({
      driverId: 'drv_1',
      utr: 'UTR12345678',
      notes: 'Weekly payout batch',
    });

    expect(result.payout.amountPaise).toBe(100_000);
    expect(result.payout.status).toBe('PAID');
    expect(result.payout.utr).toBe('UTR12345678');
    expect(result.ledgerEntry.entryType).toBe('PAYOUT');
    expect(result.ledgerEntry.amountPaise).toBe(-100_000);
    expect(result.newBalancePaise).toBe(0);
  });

  it('disburses a partial payout successfully', async () => {
    const ledgerRepo = fakeRepo();
    const payoutRepo = fakePayoutRepo();

    await new AppendLedgerEntriesUseCase(ledgerRepo).execute([
      { driverId: 'drv_1', bookingId: 'bkg_1', entryType: 'TRIP_EARNING', amountPaise: 100_000 },
    ]);

    const useCase = new ProcessPayoutUseCase(ledgerRepo, payoutRepo);
    const result = await useCase.execute({
      driverId: 'drv_1',
      amountPaise: 40_000,
      utr: 'UTR87654321',
    });

    expect(result.payout.amountPaise).toBe(40_000);
    expect(result.ledgerEntry.amountPaise).toBe(-40_000);
    expect(result.newBalancePaise).toBe(60_000);
  });

  it('refuses payout when driver has zero or negative balance', async () => {
    const ledgerRepo = fakeRepo();
    const payoutRepo = fakePayoutRepo();

    const useCase = new ProcessPayoutUseCase(ledgerRepo, payoutRepo);
    await expect(useCase.execute({ driverId: 'drv_zero' })).rejects.toThrow(/VALIDATION_FAILED/);
  });

  it('refuses payout when requested amount exceeds available balance', async () => {
    const ledgerRepo = fakeRepo();
    const payoutRepo = fakePayoutRepo();

    await new AppendLedgerEntriesUseCase(ledgerRepo).execute([
      { driverId: 'drv_1', bookingId: 'bkg_1', entryType: 'TRIP_EARNING', amountPaise: 20_000 },
    ]);

    const useCase = new ProcessPayoutUseCase(ledgerRepo, payoutRepo);
    await expect(
      useCase.execute({ driverId: 'drv_1', amountPaise: 30_000 }),
    ).rejects.toThrow(/VALIDATION_FAILED/);
  });
});

describe('ListPayoutsUseCase', () => {
  it('returns paginated payouts', async () => {
    const payoutRepo = fakePayoutRepo();
    await payoutRepo.create({ driverId: 'drv_1', amountPaise: 50_000 });
    await payoutRepo.create({ driverId: 'drv_2', amountPaise: 75_000 });

    const useCase = new ListPayoutsUseCase(payoutRepo);
    const result = await useCase.execute({}, 1, 10);

    expect(result.totalItems).toBe(2);
    expect(result.payouts).toHaveLength(2);
    expect(result.page).toBe(1);
  });
});


