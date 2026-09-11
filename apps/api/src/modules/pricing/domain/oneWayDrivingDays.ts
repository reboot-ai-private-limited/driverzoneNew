/**
 * DOMAIN — forward and return days for an outstation one-way trip.
 *
 * How many `hoursPerDay`-long driving days a ONE-WAY outstation trip needs, split into the days
 * the trip itself is billed for (`forwardDays`, multiplies the band fare exactly as a round trip's
 * day count already does) and the extra days paid to the driver ALONE to cover the empty drive
 * back (`extraDays` — never billed at the company's margin).
 *
 * A trip that fits in one day only earns an extra day when it used most of that day (more than
 * 80% of `hoursPerDay`) — a quick trip back is not worth a full extra day's pay. A trip that
 * already needs more than one day instead compares against a ROUND-TRIP-EQUIVALENT day count —
 * `ceil(2 × hours / hoursPerDay)`, as if the driver covered the distance twice — because once the
 * driver is genuinely away overnight, the extra is about how much of the CURRENT leg's fresh
 * driving remains, not a flat one-day floor.
 */
export function oneWayDrivingDays(
  hours: number,
  hoursPerDay: number,
): { forwardDays: number; extraDays: number } {
  const forwardDays = Math.max(1, Math.ceil(hours / hoursPerDay));

  if (forwardDays === 1) {
    return { forwardDays, extraDays: hours > hoursPerDay * 0.8 ? 1 : 0 };
  }

  const totalDays = Math.ceil((2 * hours) / hoursPerDay);
  return { forwardDays, extraDays: totalDays - forwardDays };
}
