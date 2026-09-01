/**
 * DOMAIN — UTC instants against IST wall-clock windows.
 *
 * Two different things are called "time" in this codebase and they must not be confused:
 * every timestamp is stored UTC (`{ timestamps: true }`), while every `TimeWindow` in
 * `globalSettings` is an IST wall-clock `HH:mm` an ops person typed. Asking "is this booking in
 * the late night window" is therefore a conversion, not a comparison, and there was no helper
 * for it anywhere in the repo before this file — no date library, no timezone utility, nothing.
 *
 * IST IS A FIXED +05:30 WITH NO DST. India has had one zone and no daylight saving since 1945,
 * so the offset is arithmetic rather than a lookup. `Intl.DateTimeFormat` with `Asia/Kolkata`
 * would be more obviously correct to a reader and is what `apps/web/src/lib/format.ts` uses for
 * DISPLAY — but it allocates a formatter and parses strings, and this runs inside fare
 * arithmetic on every quote. The constant is the right trade here; it is wrong only if India
 * adopts DST, which would break far more than this file.
 */

import type { TimeWindow } from '@driverzone/contracts';

const MINUTES_IN_DAY = 1440;
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * Minutes since IST midnight, `0`–`1439`. `2026-08-31T16:35:00Z` is 22:05 IST, so `1325`.
 *
 * The `+ MINUTES_IN_DAY` before the modulo matters: a UTC instant before 18:30 the previous day
 * would otherwise go negative, and `%` in JavaScript keeps the sign of the dividend rather than
 * wrapping the way clock arithmetic needs.
 */
export function istWallClockMinutes(at: Date): number {
  const utcMinutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  return (utcMinutes + IST_OFFSET_MINUTES + MINUTES_IN_DAY) % MINUTES_IN_DAY;
}

/**
 * A window as one or two half-open `[start, end)` intervals on a 24-hour line. A window that
 * wraps midnight (`22:00`–`04:00`, the late-night default) becomes two, which is what lets the
 * membership test below be a plain comparison with no circular arithmetic at the call site.
 *
 * Deliberately a copy of the same function in `settings/domain/setting.invariants.ts` rather
 * than an import: `pricing` and `settings` are BOTH TIER 0, and same-tier imports are forbidden
 * (`.dependency-cruiser.cjs`). Sharing it would mean promoting one module above the other over
 * six lines of interval maths. The shape is pinned by tests on both sides.
 */
function toIntervals(window: TimeWindow): Array<[number, number]> {
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  return end > start
    ? [[start, end]]
    : [
        [start, MINUTES_IN_DAY],
        [0, end],
      ];
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Is this instant inside the window, reading the window as IST wall-clock?
 *
 * HALF-OPEN, `[start, end)`. With the shipped defaults — late night `22:00`–`04:00`, early
 * morning `04:00`–`06:00` — that is what makes exactly 04:00 early morning and not both. The
 * two windows tile 22:00→06:00 with no gap and no overlap, and a cross-key invariant in
 * `settings` holds them that way, which is what lets the caller test them as an if/else instead
 * of a precedence rule nobody can remember.
 */
export function inWindow(at: Date, window: TimeWindow): boolean {
  const minutes = istWallClockMinutes(at);
  return toIntervals(window).some(([start, end]) => minutes >= start && minutes < end);
}
