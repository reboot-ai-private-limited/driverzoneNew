import { describe, expect, it } from 'vitest';
import {
  bpsToPercent,
  commissionSplit,
  paiseToRupees,
  percentToBps,
  rupeesToPaise,
} from './money';

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

describe('percentToBps', () => {
  it('converts a percentage to basis points', () => {
    expect(percentToBps('75')).toBe(7500);
    expect(percentToBps('7.5')).toBe(750);
  });

  it('refuses more than the whole fare, which the API caps at 10000 bps', () => {
    expect(percentToBps('100')).toBe(10000);
    expect(percentToBps('101')).toBeNull();
  });

  it('round-trips through bpsToPercent', () => {
    expect(percentToBps(bpsToPercent(7500))).toBe(7500);
    expect(percentToBps(bpsToPercent(750))).toBe(750);
  });
});

describe('commissionSplit', () => {
  it('divides the fare between driver and company', () => {
    expect(commissionSplit(90000, 7500)).toEqual({
      basePaise: 90000,
      driverPaise: 67500,
      companyPaise: 22500,
    });
  });

  /**
   * The property that made the old `residualPaise` check unnecessary. Two independently stored
   * shares could fail to add up; a derived remainder cannot.
   */
  it('always allocates exactly the base fare, at any share', () => {
    for (const bps of [0, 1, 3333, 5000, 7500, 9999, 10000]) {
      for (const base of [0, 1, 99, 12345, 90000]) {
        const split = commissionSplit(base, bps);
        expect(split.driverPaise + split.companyPaise).toBe(base);
      }
    }
  });

  it('gives the whole fare to the driver at 100%, and none at 0%', () => {
    expect(commissionSplit(90000, 10000)).toMatchObject({ driverPaise: 90000, companyPaise: 0 });
    expect(commissionSplit(90000, 0)).toMatchObject({ driverPaise: 0, companyPaise: 90000 });
  });

  it('puts the rounding remainder in the company column, never in neither', () => {
    // 33.33% of ₹1.00 is 33.33 paise. The driver rounds to 33; the company takes 67, not 66.
    const split = commissionSplit(100, 3333);

    expect(split.driverPaise).toBe(33);
    expect(split.companyPaise).toBe(67);
  });
});
