import { describe, expect, it } from 'vitest';
import { TRANSACTION_TYPES, type TransactionType } from '@driverzone/contracts';
import { toFinanceTransactionDto } from '../src/modules/admin/interface/finance.mapper.js';
import { financeTransactionsQuerySchema } from '../src/modules/admin/interface/finance.validation.js';
import type { LedgerEntry } from '../src/modules/ledger/ledger.public.js';

function entry(entryType: TransactionType, amountPaise: number): LedgerEntry {
  return {
    id: 'led_1',
    driverId: 'drv_1',
    bookingId: null,
    entryType,
    amountPaise,
    note: null,
    payoutId: null,
    idempotencyKey: null,
    createdAt: new Date('2026-09-05T10:00:00.000Z'),
  };
}

const direction = (type: TransactionType, amountPaise: number) =>
  toFinanceTransactionDto(entry(type, amountPaise), undefined).direction;

describe('finance feed direction', () => {
  /*
   * THE TWO THE SIGN RULE GETS BACKWARDS. A settlement is the only place in this ledger where
   * cash physically changes hands, and its sign points the opposite way to the movement: a driver
   * repaying us writes a POSITIVE row, and the company paying them writes a NEGATIVE one. An
   * implementation derived from the sign labels both wrong, which is how this started.
   */
  it('reads DEBT_COLLECTED as money IN despite the positive amount', () => {
    expect(direction('DEBT_COLLECTED', 116_400)).toBe('IN');
  });

  it('reads PAYOUT as money OUT despite the negative amount', () => {
    expect(direction('PAYOUT', -50_000)).toBe('OUT');
  });

  it('reads the fare as IN and the driver share as OUT', () => {
    expect(direction('CASH_COLLECTED', -55_700)).toBe('IN');
    expect(direction('TRIP_EARNING', 42_400)).toBe('OUT');
    expect(direction('COMMISSION_DEBIT', -10_000)).toBe('IN');
  });

  it('reads a penalty as IN and a bonus as OUT', () => {
    expect(direction('PENALTY', -5_000)).toBe('IN');
    expect(direction('BONUS', 5_000)).toBe('OUT');
  });

  it('falls back to the sign for ADJUSTMENT, which has no fixed direction', () => {
    expect(direction('ADJUSTMENT', 1_000)).toBe('OUT');
    expect(direction('ADJUSTMENT', -1_000)).toBe('IN');
    expect(direction('ADJUSTMENT', 0)).toBe('NEUTRAL');
  });

  it('gives every transaction type a direction', () => {
    // A type added to the enum without a direction would default to NEUTRAL and quietly render a
    // dash in the one column that says which way the money went.
    for (const type of TRANSACTION_TYPES) {
      if (type === 'ADJUSTMENT') continue;
      expect(direction(type, 1), `${type} has no direction`).not.toBe('NEUTRAL');
    }
  });

  it('labels every type from the shared map', () => {
    for (const type of TRANSACTION_TYPES) {
      const dto = toFinanceTransactionDto(entry(type, 1), { fullName: 'A', phone: null });
      expect(dto.type_label).not.toBe(type);
    }
  });
});

/**
 * The transactions feed is driver-side only, and says so.
 *
 * This exists because the first version did NOT say so: `party` and `customer_id` were left out
 * of the schema on the reasoning that an absent parameter is better than one that lies, but Zod
 * strips unknown keys by default — so `?party=CUSTOMER` was accepted, dropped, and answered with
 * driver rows and a 200. These assertions fail if anyone removes the explicit rejections before
 * the customer wallet actually joins the feed.
 */
describe('financeTransactionsQuerySchema — unsupported party filters', () => {
  it('rejects party=CUSTOMER rather than answering with driver rows', () => {
    const result = financeTransactionsQuerySchema.safeParse({ party: 'CUSTOMER' });

    expect(result.success).toBe(false);
  });

  it('rejects party=ALL', () => {
    expect(financeTransactionsQuerySchema.safeParse({ party: 'ALL' }).success).toBe(false);
  });

  it('rejects customer_id', () => {
    expect(financeTransactionsQuerySchema.safeParse({ customer_id: 'cus_1' }).success).toBe(false);
  });

  it('accepts party=DRIVER, which is what the feed already is', () => {
    expect(financeTransactionsQuerySchema.safeParse({ party: 'DRIVER' }).success).toBe(true);
  });

  it('accepts the query with no party at all', () => {
    expect(financeTransactionsQuerySchema.safeParse({}).success).toBe(true);
  });

  it('still rejects an unknown party value outright', () => {
    expect(financeTransactionsQuerySchema.safeParse({ party: 'BOTH' }).success).toBe(false);
  });
});
