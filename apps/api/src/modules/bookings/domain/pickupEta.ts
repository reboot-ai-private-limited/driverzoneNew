import type { BookingStatus } from '@driverzone/contracts';
import { type Point, distanceMetres } from './distance.js';

/**
 * DOMAIN — roughly how long until the driver reaches the pickup point.
 *
 * **A STRAIGHT LINE AND AN ASSUMED SPEED, NOT A ROUTE.** No router is called and nothing is
 * billed. That is a deliberate first version rather than an oversight: `RoadDistancePort` already
 * exposes `travelDurationMinutes`, and swapping it in here is a small change — but it is a paid
 * Google Routes call, the customer's trip screen polls every four seconds, and a moving driver
 * leaves `CachingRoadDistance`'s 110 m grid on almost every poll. The naive wiring is therefore
 * ~15 billed calls per minute per live booking, and the cache that makes quoting cheap does
 * nothing for it.
 *
 * So this buys the feature for nothing, and the day the estimate is visibly wrong often enough to
 * matter, the upgrade is to call the router HERE and cache the answer per booking for ~60s — not
 * to reach for the router from the read path.
 *
 * WHAT IT IS WORTH. Over a typical 2–8 km pickup leg the detour factor is right on average and
 * wrong on any individual trip, which is exactly why the same arithmetic is banned from pricing
 * (`HaversineRoadDistance` refuses to construct in production, because a band it puts a trip in
 * the wrong side of is money). An arrival estimate is not money: being two minutes out is a
 * slightly wrong expectation, and the contract requires the apps to render it as approximate.
 */

/**
 * Straight line → road, the same 1.3 the dev road-distance stand-in uses, and for the same
 * reason: it is the usual figure for Indian plains. Kept in step with that constant on purpose —
 * if one is ever re-derived from real trip data, the other should move with it.
 */
const DETOUR_FACTOR = 1.3;

/**
 * Assumed average speed, in km/h, for a driver coming to a pickup.
 *
 * DELIBERATELY LOWER than the 45 km/h the road-distance stand-in assumes. That figure is for a
 * whole outstation leg, most of which is open road; this is the last few kilometres through the
 * city a driver is actually collecting somebody in, which is traffic lights, one-ways and the
 * hunt for the door. Estimating that leg at highway speed is how an ETA becomes a complaint.
 */
const PICKUP_SPEED_KMPH = 22;

/**
 * A fix older than this is not evidence of where the driver is NOW.
 *
 * WIDER THAN `MAX_FIX_AGE_MS`, which guards the arrival check, and the difference is the point.
 * That one decides whether a driver may declare themselves at the pickup — a claim worth money
 * and worth refusing on a stale fix. This one only decides whether to show the customer an
 * approximate number, so it can tolerate the lift, the tunnel and the flyover underpass that
 * would otherwise blank the line every couple of minutes. Drivers flush their buffer every 15
 * seconds, so a gap this wide means something is genuinely wrong rather than merely slow.
 */
const MAX_FIX_AGE_MS = 3 * 60_000;

/**
 * Beyond this, the answer is bad data rather than a long drive.
 *
 * A driver assigned to a pickup 200 km away is a stale position from a previous city, a
 * transposed coordinate pair, or a test fixture — not somebody who is coming. Returning six hours
 * would be arithmetically correct and useless, so this returns null and the screen keeps its
 * ordinary "Driver on the way" line.
 */
const MAX_PLAUSIBLE_METRES = 60_000;

/**
 * The statuses in which a customer is waiting for a driver to turn up.
 *
 * ARRIVED IS ABSENT, and that is the one worth stating: the driver is there, the question has
 * been answered by events, and "~1 min" beside "Driver has arrived" is the screen contradicting
 * itself. STARTED and everything after are absent for the same reason — the trip is the answer.
 *
 * Listed rather than derived from "not terminal" so that a status added to the machine later is a
 * deliberate decision about this line, not something a negation quietly absorbs.
 */
const AWAITING_PICKUP_STATUSES: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
]);

export interface PickupEtaInput {
  status: BookingStatus;
  pickup: Point;
  /** The driver's last reported position, or null when none has ever been recorded. */
  driverAt: Point | null;
  /** When that position was reported. Null is treated exactly as a stale fix. */
  driverFixAt: Date | null;
  now: Date;
}

/**
 * Whole minutes, or null when there is no useful answer — see the field's own note in contracts
 * for what each null means to the app reading it.
 *
 * NEVER RETURNS ZERO. A driver who is practically on top of the pickup still has to stop, park
 * and be found, and "0 min" reads as a fact that is about to be falsified. One is the floor.
 */
export function estimatePickupEtaMinutes(input: PickupEtaInput): number | null {
  if (!AWAITING_PICKUP_STATUSES.has(input.status)) return null;
  if (input.driverAt === null || input.driverFixAt === null) return null;

  const fixAge = input.now.getTime() - input.driverFixAt.getTime();
  // A fix from the FUTURE is a clock-skewed handset, not a fresh position. Treated as stale
  // rather than clamped: a device whose clock is wrong is not evidence of anything.
  if (fixAge < 0 || fixAge > MAX_FIX_AGE_MS) return null;

  const straightMetres = distanceMetres(input.driverAt, input.pickup);
  if (straightMetres > MAX_PLAUSIBLE_METRES) return null;

  const roadKm = (straightMetres * DETOUR_FACTOR) / 1000;
  const minutes = (roadKm / PICKUP_SPEED_KMPH) * 60;

  return Math.max(1, Math.ceil(minutes));
}
