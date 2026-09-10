import { describe, expect, it } from 'vitest';
import { commissionSplit, paiseToRupees, rupeesToPaise } from './money';

describe('rupeesToPaise', () => {
  it('converts whole rupees', () => {
    expect(rupeesToPaise('900')).toBe(90000);
  });

  it('converts paise precision', () => {
    expect(rupeesToPaise('12.50')).toBe(1250);
  });

  it('keeps zero, which is a real fare and not an empty box', () => {
    expect(rupeesToPaise('0')).toBe(0);
  });

  it('rejects an empty box, which is a field nobody has filled in', () => {
    expect(rupeesToPaise('')).toBeNull();
    expect(rupeesToPaise('   ')).toBeNull();
  });

  it('rejects the forms Number() would silently accept', () => {
    expect(rupeesToPaise('1e3')).toBeNull();
    expect(rupeesToPaise('0x10')).toBeNull();
    expect(rupeesToPaise('-5')).toBeNull();
    expect(rupeesToPaise('12.345')).toBeNull();
  });
});

describe('paiseToRupees', () => {
  it('drops the decimals on a whole rupee', () => {
    expect(paiseToRupees(90000)).toBe('900');
  });

  it('keeps them when there are paise', () => {
    expect(paiseToRupees(1250)).toBe('12.50');
  });

  it('round-trips through rupeesToPaise', () => {
    for (const paise of [0, 1, 99, 100, 1250, 90000]) {
      expect(rupeesToPaise(paiseToRupees(paise))).toBe(paise);
    }
  });
});

describe('commissionSplit', () => {
  it('pays the driver their amount and gives the company the remainder', () => {
    expect(commissionSplit(90000, 67500)).toEqual({
      basePaise: 90000,
      driverPaise: 67500,
      companyPaise: 22500,
    });
  });

  /**
   * The property that made the old `residualPaise` check unnecessary: a derived remainder cannot
   * fail to add up.
   */
  it('always allocates exactly the base fare', () => {
    for (const amount of [0, 1, 12345, 45000, 90000]) {
      for (const base of [0, 1, 99, 12345, 90000]) {
        const split = commissionSplit(base, amount);
        expect(split.driverPaise + split.companyPaise).toBe(base);
      }
    }
  });

  it('gives the whole fare to the driver when the amount equals it, and none at 0', () => {
    expect(commissionSplit(90000, 90000)).toMatchObject({ driverPaise: 90000, companyPaise: 0 });
    expect(commissionSplit(90000, 0)).toMatchObject({ driverPaise: 0, companyPaise: 90000 });
  });

  it('clamps an over-fare amount rather than rendering a negative company share', () => {
    // The preview backstop, mirroring the API's `splitFare`. Saving is refused before this, but
    // an old package or a fare cut can still reach it.
    const split = commissionSplit(30000, 45000);
    expect(split.driverPaise).toBe(30000);
    expect(split.companyPaise).toBe(0);
  });

  it('treats a negative amount as zero', () => {
    expect(commissionSplit(90000, -100)).toMatchObject({ driverPaise: 0, companyPaise: 90000 });
  });
});
