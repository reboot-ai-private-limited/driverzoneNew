import { describe, expect, it } from 'vitest';
import { oneWayDrivingDays } from '../src/modules/pricing/domain/oneWayDrivingDays.js';

describe('oneWayDrivingDays', () => {
  const HOURS_PER_DAY = 10;

  it('keeps short single-day trips at forward 1, extra 0 when within 80% of the day', () => {
    expect(oneWayDrivingDays(1, HOURS_PER_DAY)).toEqual({ forwardDays: 1, extraDays: 0 });
    expect(oneWayDrivingDays(6, HOURS_PER_DAY)).toEqual({ forwardDays: 1, extraDays: 0 });
    // Exactly 8 hours is 80%, not over it
    expect(oneWayDrivingDays(8, HOURS_PER_DAY)).toEqual({ forwardDays: 1, extraDays: 0 });
  });

  it('charges 1 extra return day when a single-day trip exceeds 8 hours (80%)', () => {
    expect(oneWayDrivingDays(8.01, HOURS_PER_DAY)).toEqual({ forwardDays: 1, extraDays: 1 });
    expect(oneWayDrivingDays(9, HOURS_PER_DAY)).toEqual({ forwardDays: 1, extraDays: 1 });
    expect(oneWayDrivingDays(10, HOURS_PER_DAY)).toEqual({ forwardDays: 1, extraDays: 1 });
  });

  it('applies the 5-hour grace window on 2-day trips (11h to 15h -> extra 1, 16h to 20h -> extra 2)', () => {
    // 11h: forward 2, total ceil(22/10)=3 -> extra 1
    expect(oneWayDrivingDays(11, HOURS_PER_DAY)).toEqual({ forwardDays: 2, extraDays: 1 });
    // 15h: forward 2, total ceil(30/10)=3 -> extra 1 (5h grace)
    expect(oneWayDrivingDays(15, HOURS_PER_DAY)).toEqual({ forwardDays: 2, extraDays: 1 });
    // 16h: forward 2, total ceil(32/10)=4 -> extra 2 (past grace, full return day)
    expect(oneWayDrivingDays(16, HOURS_PER_DAY)).toEqual({ forwardDays: 2, extraDays: 2 });
    // 20h: forward 2, total ceil(40/10)=4 -> extra 2
    expect(oneWayDrivingDays(20, HOURS_PER_DAY)).toEqual({ forwardDays: 2, extraDays: 2 });
  });

  it('applies the round-trip equivalent formula on 3-day trips (21h to 25h -> extra 2, 26h to 30h -> extra 3)', () => {
    // 21h: forward 3, total ceil(42/10)=5 -> extra 2
    expect(oneWayDrivingDays(21, HOURS_PER_DAY)).toEqual({ forwardDays: 3, extraDays: 2 });
    // 25h: forward 3, total ceil(50/10)=5 -> extra 2
    expect(oneWayDrivingDays(25, HOURS_PER_DAY)).toEqual({ forwardDays: 3, extraDays: 2 });
    // 26h: forward 3, total ceil(52/10)=6 -> extra 3
    expect(oneWayDrivingDays(26, HOURS_PER_DAY)).toEqual({ forwardDays: 3, extraDays: 3 });
    // 30h: forward 3, total ceil(60/10)=6 -> extra 3
    expect(oneWayDrivingDays(30, HOURS_PER_DAY)).toEqual({ forwardDays: 3, extraDays: 3 });
  });

  it('handles zero or negative edge cases safely by returning at least forward 1', () => {
    expect(oneWayDrivingDays(0, HOURS_PER_DAY)).toEqual({ forwardDays: 1, extraDays: 0 });
    expect(oneWayDrivingDays(-5, HOURS_PER_DAY)).toEqual({ forwardDays: 1, extraDays: 0 });
  });
});
