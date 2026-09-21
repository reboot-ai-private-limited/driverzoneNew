import { describe, expect, it } from 'vitest';
import { AppError } from '../src/shared/errors/AppError.js';
import {
  assertFareReconciles,
  computeCustomerCancellationFee,
  computeDriverCancellationPenalty,
  computeDriverLateFine,
  computeIncityFare,
  computeOutstationFare,
  computeWaitingCharge,
  inWindow,
  istCalendarDaysInclusive,
  istWallClockMinutes,
  splitFare,
  surchargeFor,
  type CancellationConfig,
  type FareConfig,
  type PickupZoneFare,
} from '../src/modules/pricing/pricing.public.js';

/**
 * `pricing` is pure, so this suite is the real acceptance test for every money rule in the
 * product — no Mongo, no fakes, no container. Anything that needs a database to be checked has
 * been put in the wrong module.
 */

/** A Date for an IST wall-clock time on 2026-08-31. IST is UTC+05:30, so subtract 330 minutes. */
function ist(hours: number, minutes = 0): Date {
  return new Date(Date.UTC(2026, 7, 31, hours, minutes) - 330 * 60_000);
}

const config: FareConfig = {
  earlyMorningWindow: { start: '04:00', end: '06:00' },
  earlyMorningChargePaise: 10_000, // ₹100
  lateNightWindow: { start: '22:00', end: '04:00' },
  lateNightChargePaise: 15_000, // ₹150
  insuranceChargePaise: 3_000, // ₹30
  taxBps: 500, // 5%
};

const paidZone: PickupZoneFare = {
  name: 'Siliguri Outskirts',
  chargeType: 'PAID',
  chargePaise: null,
  defaultChargePaise: 10_000,
};

const freeZone: PickupZoneFare = {
  name: 'Siliguri Central',
  chargeType: 'FREE',
  chargePaise: null,
  defaultChargePaise: 10_000,
};

describe('istWallClockMinutes', () => {
  it('converts a UTC instant to minutes since IST midnight', () => {
    expect(istWallClockMinutes(ist(0, 0))).toBe(0);
    expect(istWallClockMinutes(ist(12, 0))).toBe(720);
    expect(istWallClockMinutes(ist(22, 5))).toBe(22 * 60 + 5);
    expect(istWallClockMinutes(ist(23, 59))).toBe(1439);
  });

  it('wraps rather than going negative for a UTC instant before 18:30 the previous day', () => {
    // 02:00 IST is 20:30 UTC on the PREVIOUS calendar day — the case a naive `%` gets wrong.
    expect(istWallClockMinutes(ist(2, 0))).toBe(120);
  });
});

describe('istCalendarDaysInclusive', () => {
  // Days multiply an outstation fare, so an off-by-one here is an off-by-one on somebody's money.
  const at = (iso: string): Date => new Date(iso);

  it('counts a same-day return as one', () => {
    // The property that keeps every pre-existing fare where it was.
    expect(istCalendarDaysInclusive(at('2026-05-18T04:00:00Z'), at('2026-05-18T12:00:00Z'))).toBe(1);
  });

  it('counts calendar days, not elapsed time', () => {
    // 23:00 IST on the 18th to 01:00 IST on the 19th is two hours of clock and two days of the
    // driver's life. Dividing the gap by 86,400,000 would call it one and halve the fare.
    expect(istCalendarDaysInclusive(at('2026-05-18T17:30:00Z'), at('2026-05-18T19:30:00Z'))).toBe(2);
  });

  it('reads the boundary in IST, not UTC', () => {
    // Both instants are the 19th in India — 00:30 and 11:30 IST — though the first is still the
    // 18th in UTC. Flooring the raw UTC instants would say two days and overcharge by half.
    expect(istCalendarDaysInclusive(at('2026-05-18T19:00:00Z'), at('2026-05-19T06:00:00Z'))).toBe(1);
  });

  it('counts a three-day trip as three', () => {
    expect(istCalendarDaysInclusive(at('2026-05-18T04:00:00Z'), at('2026-05-20T12:00:00Z'))).toBe(3);
  });

  it('never returns less than one, however the inputs are ordered', () => {
    // The validator refuses a return before the pickup; if one arrives anyway it must not produce
    // a zero or negative multiplier on a fare.
    expect(istCalendarDaysInclusive(at('2026-05-20T04:00:00Z'), at('2026-05-18T04:00:00Z'))).toBe(1);
  });
});

describe('inWindow', () => {
  it('handles a window that wraps midnight', () => {
    const lateNight = config.lateNightWindow;
    expect(inWindow(ist(23, 0), lateNight)).toBe(true);
    expect(inWindow(ist(1, 0), lateNight)).toBe(true);
    expect(inWindow(ist(12, 0), lateNight)).toBe(false);
  });

  it('is half-open: the start is inside, the end is not', () => {
    expect(inWindow(ist(22, 0), config.lateNightWindow)).toBe(true);
    expect(inWindow(ist(4, 0), config.lateNightWindow)).toBe(false);

    expect(inWindow(ist(4, 0), config.earlyMorningWindow)).toBe(true);
    expect(inWindow(ist(6, 0), config.earlyMorningWindow)).toBe(false);
  });

  it('tiles 22:00 to 06:00 with no gap and no double-cover', () => {
    // The two shipped windows must partition the antisocial hours exactly — this is the property
    // that lets surchargeFor be an if/else rather than a precedence rule.
    for (let minute = 0; minute < 1440; minute += 1) {
      const at = ist(0, minute);
      const hits =
        Number(inWindow(at, config.lateNightWindow)) +
        Number(inWindow(at, config.earlyMorningWindow));
      const antisocial = minute >= 22 * 60 || minute < 6 * 60;
      expect(hits).toBe(antisocial ? 1 : 0);
    }
  });
});

describe('surchargeFor', () => {
  it('charges late night inside the late night window', () => {
    expect(surchargeFor(ist(22, 5), config)).toEqual({
      code: 'NIGHT',
      label: 'Late night charge',
      amountPaise: 15_000,
    });
  });

  it('charges early morning inside the early morning window', () => {
    expect(surchargeFor(ist(4, 30), config)?.code).toBe('EARLY_MORNING');
  });

  it('charges nothing outside both windows', () => {
    expect(surchargeFor(ist(12, 0), config)).toBeNull();
  });

  it('treats a zero charge as the surcharge being switched off', () => {
    // The registry says a charge of 0 disables the surcharge while the window stays meaningful.
    expect(surchargeFor(ist(22, 5), { ...config, lateNightChargePaise: 0 })).toBeNull();
  });

  it('decides from the scheduled pickup instant, not from how long the trip runs', () => {
    // The documented consequence of closing Q8 this way, pinned so it is a decision and not a
    // regression: a 4-hour rental booked for 21:55 runs to 01:55 and pays nothing.
    expect(surchargeFor(ist(21, 55), config)).toBeNull();
    expect(surchargeFor(ist(22, 0), config)?.code).toBe('NIGHT');
  });
});

describe('computeIncityFare', () => {
  const input = {
    variantLabel: '3 Hours',
    baseFarePaise: 90_000,
    // A flat amount now, not 75% of the subtotal. 77_250 keeps the worked example's numbers
    // identical: it happens to equal 75% of the 103_000 subtotal this input produces.
    driverAmountPaise: 77_250,
    pickupZone: paidZone,
    scheduledAt: ist(12, 0),
  };

  it('builds the documented worked example', () => {
    const fare = computeIncityFare(input, config);

    expect(fare.lines).toEqual([
      { code: 'BASE', label: '3 Hours', amountPaise: 90_000 },
      { code: 'PICKUP_FEE', label: 'Pickup charge (Siliguri Outskirts)', amountPaise: 10_000 },
      { code: 'INSURANCE', label: 'Insurance', amountPaise: 3_000 },
    ]);
    expect(fare.subtotalPaise).toBe(103_000);
    expect(fare.totalPaise).toBe(108_200);
    expect(fare.taxPaise).toBe(5_200);
    expect(fare.split).toEqual({
      commissionablePaise: 103_000,
      driverAmountPaise: 77_250,
      driverPaise: 77_250,
      companyPaise: 25_750,
    });
  });

  it('adds no line at all for a FREE pickup zone', () => {
    const fare = computeIncityFare({ ...input, pickupZone: freeZone }, config);
    expect(fare.lines.map((l) => l.code)).not.toContain('PICKUP_FEE');
  });

  it("prefers the zone's own charge over the settings default", () => {
    const fare = computeIncityFare(
      { ...input, pickupZone: { ...paidZone, chargePaise: 25_000 } },
      config,
    );
    expect(fare.lines.find((l) => l.code === 'PICKUP_FEE')?.amountPaise).toBe(25_000);
  });

  it('adds the night charge for a late night pickup', () => {
    const fare = computeIncityFare({ ...input, scheduledAt: ist(23, 0) }, config);
    expect(fare.lines.find((l) => l.code === 'NIGHT')?.amountPaise).toBe(15_000);
    expect(fare.subtotalPaise).toBe(118_000);
  });

  it('rounds the total to a whole rupee', () => {
    const fare = computeIncityFare({ ...input, baseFarePaise: 90_037 }, config);
    expect(fare.totalPaise % 100).toBe(0);
  });
});

describe('computeOutstationFare', () => {
  const input = {
    packageName: 'PKG-3',
    terrain: 'HILL' as const,
    direction: 'ONE_WAY' as const,
    farePaise: 450_000,
    days: 1,
    // Flat, per day. Multiplied by `days` alongside the band fare — see the test below.
    driverAmountPaise: 300_000,
    pickupZone: freeZone,
    scheduledAt: ist(9, 0),
  };

  it('prices a one-way band flat', () => {
    const fare = computeOutstationFare(input, config);
    expect(fare.serviceType).toBe('OUTSTATION');
    expect(fare.lines[0]).toEqual({
      code: 'BASE',
      label: 'PKG-3 — One way',
      amountPaise: 450_000,
    });
    expect(fare.subtotalPaise).toBe(453_000);
  });

  it('uses the band round-trip fare rather than doubling the one-way', () => {
    const fare = computeOutstationFare(
      { ...input, direction: 'ROUND_TRIP', farePaise: 700_000 },
      config,
    );
    expect(fare.lines[0]?.amountPaise).toBe(700_000);
    expect(fare.lines[0]?.label).toBe('PKG-3 — Return journey');
  });

  /*
   * The band fare is a DAY RATE. These are the tests that pin that decision — before it, a
   * customer could pick a return three days out and pay the same-day price.
   */
  it('leaves a single-day trip at exactly the band fare', () => {
    // THE BACKWARD-COMPATIBILITY PROPERTY. Every fare that existed before multiplying was
    // introduced must be untouched by it, and `days: 1` is what guarantees that.
    const fare = computeOutstationFare({ ...input, days: 1 }, config);
    expect(fare.lines[0]?.amountPaise).toBe(450_000);
    expect(fare.lines[0]?.label).toBe('PKG-3 — One way');
  });

  it('multiplies the band fare by the days and says so on the line', () => {
    const fare = computeOutstationFare(
      { ...input, direction: 'ROUND_TRIP', farePaise: 700_000, days: 3 },
      config,
    );
    expect(fare.lines[0]?.amountPaise).toBe(2_100_000);
    // The count is in the label because a tripled number with an unchanged label is a support call.
    expect(fare.lines[0]?.label).toBe('PKG-3 — Return journey × 3 days');
  });

  it('multiplies only the base — the shared lines are not per-day', () => {
    const oneDay = computeOutstationFare({ ...input, direction: 'ROUND_TRIP' }, config);
    const threeDay = computeOutstationFare(
      { ...input, direction: 'ROUND_TRIP', days: 3 },
      config,
    );

    // A pickup charge, insurance and the surcharge are properties of the trip, not of each day.
    for (const code of ['PICKUP', 'INSURANCE'] as const) {
      expect(threeDay.lines.find((l) => l.code === code)?.amountPaise).toBe(
        oneDay.lines.find((l) => l.code === code)?.amountPaise,
      );
    }
  });

  it('splits the multiplied fare, so extra days are commissionable too', () => {
    const fare = computeOutstationFare({ ...input, direction: 'ROUND_TRIP', days: 2 }, config);
    // Whatever the split is, it has to reconcile against the doubled subtotal rather than a
    // single day's — the whole amount is commissionable.
    expect(fare.split.driverPaise + fare.split.companyPaise).toBe(fare.split.commissionablePaise);
    expect(fare.lines[0]?.amountPaise).toBe(900_000);
  });

  it("multiplies the driver's amount by the days, exactly as it does the fare", () => {
    // A driver away three days is paid three times. Both sides of the split scale by `days`; the
    // fixed lines do not, which is why the company's share grows faster across a long trip.
    const oneDay = computeOutstationFare({ ...input, direction: 'ROUND_TRIP' }, config);
    const threeDay = computeOutstationFare(
      { ...input, direction: 'ROUND_TRIP', days: 3 },
      config,
    );
    expect(threeDay.split.driverAmountPaise).toBe(oneDay.split.driverAmountPaise * 3);
    expect(threeDay.split.driverPaise).toBe(900_000); // 300_000 per day × 3
  });

  it('applies the surcharge on the pickup instant, never on the journey length', () => {
    // A multi-day outstation trip departing at noon pays no night charge, however long it runs.
    expect(computeOutstationFare(input, config).lines.map((l) => l.code)).not.toContain('NIGHT');
    expect(
      computeOutstationFare({ ...input, scheduledAt: ist(4, 30) }, config).lines.map((l) => l.code),
    ).toContain('EARLY_MORNING');
  });

  it('does not add a return allowance when extraDays is 0 or omitted on one-way trips', () => {
    const fare = computeOutstationFare({ ...input, days: 1, extraDays: 0 }, config);
    expect(fare.lines.find((l) => l.code === 'RETURN_DRIVER_ALLOWANCE')).toBeUndefined();
    expect(fare.lines[0]?.amountPaise).toBe(450_000);
    expect(fare.split.driverPaise).toBe(300_000);
  });

  it('adds RETURN_DRIVER_ALLOWANCE for extraDays on a single-day one-way trip and pays 100% to the driver', () => {
    // 1-day trip exceeding 8 hours gets 1 extra return day
    const fare = computeOutstationFare({ ...input, days: 1, extraDays: 1 }, config);
    const returnLine = fare.lines.find((l) => l.code === 'RETURN_DRIVER_ALLOWANCE');
    expect(returnLine).toEqual({
      code: 'RETURN_DRIVER_ALLOWANCE',
      label: 'Return trip allowance for your driver × 1 day',
      amountPaise: 300_000,
    });
    // Base line remains unchanged at 1 day
    expect(fare.lines[0]?.amountPaise).toBe(450_000);
    // Driver gets 1 day base (300k) + 1 day return (300k) = 600k
    expect(fare.split.driverAmountPaise).toBe(600_000);
    expect(fare.split.driverPaise).toBe(600_000);
    // Company margin is unchanged: (450k - 300k) + insurance (3k) = 153k
    expect(fare.split.companyPaise).toBe(153_000);
  });

  it('handles multi-day one-way trip (e.g. 16 hours -> days: 2, extraDays: 2) leaving company margin untouched', () => {
    const fare = computeOutstationFare({ ...input, days: 2, extraDays: 2 }, config);
    const returnLine = fare.lines.find((l) => l.code === 'RETURN_DRIVER_ALLOWANCE');
    expect(returnLine).toEqual({
      code: 'RETURN_DRIVER_ALLOWANCE',
      label: 'Return trip allowance for your driver × 2 days',
      amountPaise: 600_000,
    });
    expect(fare.lines[0]?.amountPaise).toBe(900_000);
    // Driver receives 2 days forward (600k) + 2 days return (600k) = 1,200k
    expect(fare.split.driverPaise).toBe(1_200_000);
    // Company margin equals exactly 2 forward days: (450k * 2 - 300k * 2) + insurance (3k) = 303k
    expect(fare.split.companyPaise).toBe(303_000);
    expect(fare.split.driverPaise + fare.split.companyPaise).toBe(fare.split.commissionablePaise);
  });

  it('never adds RETURN_DRIVER_ALLOWANCE to a ROUND_TRIP', () => {
    const fare = computeOutstationFare(
      { ...input, direction: 'ROUND_TRIP', days: 3, extraDays: 0 },
      config,
    );
    expect(fare.lines.find((l) => l.code === 'RETURN_DRIVER_ALLOWANCE')).toBeUndefined();
  });
});

describe('splitFare', () => {
  it('pays the driver their amount and gives the company the remainder', () => {
    const split = splitFare(100_001, 60_000);
    expect(split.driverPaise).toBe(60_000);
    expect(split.companyPaise).toBe(40_001);
    expect(split.driverPaise + split.companyPaise).toBe(100_001);
  });

  it('records the configured amount alongside what was actually paid', () => {
    const split = splitFare(100_000, 40_000);
    expect(split.driverAmountPaise).toBe(40_000);
    expect(split.driverPaise).toBe(40_000);
  });

  /*
   * THE UNMIGRATED PACKAGE. `driverAmountPaise` replaced a percentage on 2026-09-10, and Mongoose's
   * `required: true` only validates on write — so a package written before that reads back with
   * the field absent and arrives here as `undefined` despite the type.
   *
   * It used to produce `NaN`, which serialises to `null`, and the failure surfaced from
   * `assertFareReconciles` as a reconciliation error full of nulls: an error about arithmetic
   * that never happened, naming the wrong subsystem. Found in the field as "we could not get a
   * price" with nothing connecting it to an unmigrated package.
   */
  it('refuses to split when the driver amount is missing, rather than producing NaN', () => {
    /*
     * The REASON is asserted, not the message. `AppError.internal` deliberately shows a customer
     * the same neutral sentence for every fault; what identifies this one is the detail behind
     * it, and that detail is the whole point of the guard — it names the unmigrated package
     * instead of blaming fare arithmetic.
     */
    let thrown: unknown;
    try {
      splitFare(100_000, undefined as unknown as number);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).details).toMatchObject({
      reason: expect.stringMatching(/driver amount/i) as unknown as string,
      driverAmountPaise: undefined,
    });
  });

  it('refuses a non-finite commissionable total for the same reason', () => {
    expect(() => splitFare(Number.NaN, 40_000)).toThrow(AppError);
  });

  it('takes nothing for the company at the full fare, and pays nothing at 0', () => {
    expect(splitFare(50_000, 50_000).companyPaise).toBe(0);
    expect(splitFare(50_000, 0).driverPaise).toBe(0);
  });

  it('clamps rather than paying out more than the fare, and still reconciles', () => {
    // The backstop for a misconfigured package that slipped past validation. Driver paid in full
    // up to the fare, company floors at zero, and `driverAmountPaise` keeps the configured figure
    // so the shortfall is visible in stored data.
    const split = splitFare(30_000, 45_000);
    expect(split.driverPaise).toBe(30_000);
    expect(split.companyPaise).toBe(0);
    expect(split.driverAmountPaise).toBe(45_000);
    expect(split.driverPaise + split.companyPaise).toBe(30_000);
  });

  it('throws rather than returning a fare that does not reconcile', () => {
    expect(() => assertFareReconciles(splitFare(1_000, 750), 50, 9_999)).toThrow();
  });
});

describe('every fare reconciles', () => {
  it('holds across the whole plausible input space', () => {
    // The property the LLD asks for: driver + company + tax === total, always. Fare arithmetic
    // that does not reconcile is how you end up unable to close the books, and the rounding-
    // absorption decision in computeFare.ts is exactly what this is guarding.
    for (let base = 10_000; base <= 900_000; base += 7_331) {
      // Includes `base * 3`, which exceeds the subtotal and makes the clamp fire — the identity
      // still has to hold with the company's share floored at zero.
      for (const driverAmountPaise of [0, Math.floor(base / 3), base, base * 3]) {
        for (const at of [ist(12, 0), ist(23, 0), ist(4, 30)]) {
          const fare = computeIncityFare(
            {
              variantLabel: 'n Hours',
              baseFarePaise: base,
              driverAmountPaise,
              pickupZone: paidZone,
              scheduledAt: at,
            },
            config,
          );

          expect(fare.split.driverPaise + fare.split.companyPaise + fare.taxPaise).toBe(
            fare.totalPaise,
          );
          expect(fare.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(fare.subtotalPaise);
          expect(fare.totalPaise % 100).toBe(0);
        }
      }
    }
  });
});

describe('computeWaitingCharge', () => {
  const waiting = { freeMinutes: 15, chargePerMinutePaise: 200, maxChargePaise: 30_000 };
  const arrived = ist(9, 0);

  it('charges nothing inside the free window', () => {
    expect(computeWaitingCharge(arrived, ist(9, 15), waiting).amountPaise).toBe(0);
  });

  it('charges only the minutes past the free window', () => {
    const charge = computeWaitingCharge(arrived, ist(9, 40), waiting);
    expect(charge.waitedMinutes).toBe(40);
    expect(charge.chargeableMinutes).toBe(25);
    expect(charge.amountPaise).toBe(5_000); // 25 × ₹2
    expect(charge.capped).toBe(false);
  });

  it('floors partial minutes rather than billing a whole one for seconds', () => {
    const startedAt = new Date(ist(9, 40).getTime() + 59_000);
    expect(computeWaitingCharge(arrived, startedAt, waiting).chargeableMinutes).toBe(25);
  });

  it('caps, and says that it capped', () => {
    const charge = computeWaitingCharge(arrived, ist(23, 0), waiting);
    expect(charge.amountPaise).toBe(30_000);
    expect(charge.capped).toBe(true);
  });

  it('never goes negative if the clocks arrive out of order', () => {
    expect(computeWaitingCharge(ist(9, 30), ist(9, 0), waiting).amountPaise).toBe(0);
  });
});

describe('computeDriverLateFine', () => {
  const late = { graceMinutes: 10, finePaise: 5_000 };
  const scheduled = ist(9, 0);

  it('does not fine a driver inside the grace period', () => {
    expect(computeDriverLateFine(scheduled, ist(9, 10), late).amountPaise).toBe(0);
  });

  it('fines a flat amount once past the grace period', () => {
    const fine = computeDriverLateFine(scheduled, ist(9, 11), late);
    expect(fine.lateMinutes).toBe(11);
    expect(fine.amountPaise).toBe(5_000);
  });

  it('stays flat however late the driver is', () => {
    expect(computeDriverLateFine(scheduled, ist(11, 0), late).amountPaise).toBe(5_000);
  });

  it('does not fine an early driver', () => {
    const fine = computeDriverLateFine(scheduled, ist(8, 45), late);
    expect(fine.lateMinutes).toBe(0);
    expect(fine.amountPaise).toBe(0);
  });

  it('is disabled by a fine of 0', () => {
    expect(computeDriverLateFine(scheduled, ist(11, 0), { ...late, finePaise: 0 }).amountPaise).toBe(0);
  });
});

describe('cancellation', () => {
  const cancellation: CancellationConfig = {
    freeWindowSeconds: 300,
    scheduledFreeUntilMinutesBefore: 60,
    customerFeeEnRoutePaise: 5_000,
    customerFeeArrivedPaise: 10_000,
    driverPenaltyEnRoutePaise: 5_000,
    driverPenaltyArrivedPaise: 10_000,
  };

  const base = {
    confirmedAt: ist(8, 0),
    hasBeenAssigned: true,
    scheduledAt: ist(9, 0),
    isScheduled: false,
    at: ist(8, 30),
  };

  it('is free before a driver has set off', () => {
    for (const status of ['CONFIRMED', 'SEARCHING', 'ASSIGNED'] as const) {
      expect(computeCustomerCancellationFee({ ...base, status }, cancellation)).toBe(0);
    }
  });

  it('steps up once the driver is en route, and again once they have arrived', () => {
    expect(
      computeCustomerCancellationFee({ ...base, status: 'DRIVER_EN_ROUTE' }, cancellation),
    ).toBe(5_000);
    expect(computeCustomerCancellationFee({ ...base, status: 'ARRIVED' }, cancellation)).toBe(
      10_000,
    );
  });

  it('does NOT let the free window excuse a cancellation once a driver is assigned', () => {
    /*
     * The exploit this closes: dispatch can put a driver at the door inside five minutes, so a
     * free window that overrode the ladder would let every customer cancel free while the driver
     * had already made the trip. The ladder scopes it to "before assignment" and so does this.
     */
    const justConfirmed = { ...base, confirmedAt: ist(8, 29), at: ist(8, 30), hasBeenAssigned: true };
    expect(
      computeCustomerCancellationFee({ ...justConfirmed, status: 'DRIVER_EN_ROUTE' }, cancellation),
    ).toBe(5_000);
    expect(
      computeCustomerCancellationFee({ ...justConfirmed, status: 'ARRIVED' }, cancellation),
    ).toBe(10_000);
  });

  it('honours the scheduled free window even with a driver already en route', () => {
    // Scheduled bookings dispatch at T−90 but are free to cancel until T−60, so this window
    // genuinely has to beat the ladder.
    const scheduled = {
      ...base,
      isScheduled: true,
      confirmedAt: ist(6, 0),
      scheduledAt: ist(10, 0),
      at: ist(8, 30), // 90 minutes out
    };
    expect(
      computeCustomerCancellationFee({ ...scheduled, status: 'DRIVER_EN_ROUTE' }, cancellation),
    ).toBe(0);

    // ...and stops beating it once inside T−60.
    expect(
      computeCustomerCancellationFee(
        { ...scheduled, status: 'DRIVER_EN_ROUTE', at: ist(9, 30) },
        cancellation,
      ),
    ).toBe(5_000);
  });

  it('penalises a driver who drops the trip, with no free window', () => {
    expect(computeDriverCancellationPenalty('ASSIGNED', cancellation)).toBe(0);
    expect(computeDriverCancellationPenalty('DRIVER_EN_ROUTE', cancellation)).toBe(5_000);
    expect(computeDriverCancellationPenalty('ARRIVED', cancellation)).toBe(10_000);
  });
});
