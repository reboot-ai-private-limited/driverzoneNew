import { describe, expect, it } from 'vitest';
import {
  applyWalletToFare,
  validateWalletEntry,
} from '../src/modules/wallet/domain/walletEntry.entity.js';

/**
 * The two pieces of wallet logic that decide money, tested without a database.
 *
 * `applyWalletToFare` is the arithmetic every booking runs through, and `validateWalletEntry` is
 * the guard standing between a mistyped sign and a penalty that pays the customer.
 */

describe('applyWalletToFare', () => {
  it('does nothing to a fare when the balance is zero', () => {
    expect(applyWalletToFare(0, 50_000)).toEqual({
      creditAppliedPaise: 0,
      debtAddedPaise: 0,
      payablePaise: 50_000,
    });
  });

  it('takes credit off the fare', () => {
    expect(applyWalletToFare(20_000, 50_000)).toEqual({
      creditAppliedPaise: 20_000,
      debtAddedPaise: 0,
      payablePaise: 30_000,
    });
  });

  /*
   * THE CAP IS THE POINT. A wallet is not a bank account: credit bigger than the fare pays the
   * fare and keeps the rest, and a trip can never cost less than nothing.
   */
  it('never pays out more credit than the fare, and never goes negative', () => {
    const result = applyWalletToFare(90_000, 50_000);

    expect(result.creditAppliedPaise).toBe(50_000);
    expect(result.payablePaise).toBe(0);
  });

  it('leaves the unspent remainder in the balance for the next trip', () => {
    const balance = 90_000;
    const { creditAppliedPaise } = applyWalletToFare(balance, 50_000);

    expect(balance - creditAppliedPaise).toBe(40_000);
  });

  it('adds a debt to the fare in full', () => {
    expect(applyWalletToFare(-10_000, 50_000)).toEqual({
      creditAppliedPaise: 0,
      debtAddedPaise: 10_000,
      payablePaise: 60_000,
    });
  });

  /* A debt is collected whatever it costs — that is what "added to your next ride" means. */
  it('does not cap a debt at the fare', () => {
    expect(applyWalletToFare(-200_000, 50_000).payablePaise).toBe(250_000);
  });

  it('never reports credit and debt at once', () => {
    for (const balance of [-50_000, -1, 0, 1, 50_000]) {
      const { creditAppliedPaise, debtAddedPaise } = applyWalletToFare(balance, 40_000);
      expect(Math.min(creditAppliedPaise, debtAddedPaise)).toBe(0);
    }
  });
});

describe('validateWalletEntry', () => {
  const base = { customerId: 'cus_1' };

  it('accepts a well-formed grant', () => {
    expect(
      validateWalletEntry({ ...base, entryType: 'CREDIT_GRANT', amountPaise: 10_000 }),
    ).toBeNull();
  });

  /* A fine entered positive would turn a penalty into a gift, silently. */
  it('refuses a positive fine', () => {
    expect(validateWalletEntry({ ...base, entryType: 'FINE', amountPaise: 5_000, note: 'x' })).toBe(
      'FINE must not be positive — it is money the customer owes',
    );
  });

  it('refuses a negative credit grant', () => {
    expect(validateWalletEntry({ ...base, entryType: 'CREDIT_GRANT', amountPaise: -1 })).toBe(
      'CREDIT_GRANT must not be negative — it is credit to the customer',
    );
  });

  it('refuses a zero row, which is noise in a statement rather than a correction', () => {
    expect(validateWalletEntry({ ...base, entryType: 'ADJUSTMENT', amountPaise: 0, note: 'x' })).toBe(
      'ADJUSTMENT amount must not be zero',
    );
  });

  it('refuses fractional paise', () => {
    expect(validateWalletEntry({ ...base, entryType: 'CREDIT_GRANT', amountPaise: 10.5 })).toBe(
      'CREDIT_GRANT amount must be an integer number of paise',
    );
  });

  /* An unexplained movement of somebody's money is unanswerable when they ask about it later. */
  it('requires a note on a fine and on an adjustment', () => {
    expect(validateWalletEntry({ ...base, entryType: 'FINE', amountPaise: -5_000 })).toBe(
      'FINE requires a note explaining it',
    );
    expect(validateWalletEntry({ ...base, entryType: 'ADJUSTMENT', amountPaise: -5_000 })).toBe(
      'ADJUSTMENT requires a note explaining it',
    );
  });

  it('lets an adjustment go either way, since it corrects mistakes in both directions', () => {
    expect(
      validateWalletEntry({ ...base, entryType: 'ADJUSTMENT', amountPaise: 500, note: 'fix' }),
    ).toBeNull();
    expect(
      validateWalletEntry({ ...base, entryType: 'ADJUSTMENT', amountPaise: -500, note: 'fix' }),
    ).toBeNull();
  });
});
