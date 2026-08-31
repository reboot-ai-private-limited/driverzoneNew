/**
 * DOMAIN — money that is decided after the quote was frozen.
 *
 * NONE OF THIS TOUCHES THE FARE SNAPSHOT. `bookings.fareSnapshot` is written once at confirmation
 * and never updated (invariant B-1): it is the record of what the customer agreed to, and a
 * waiting charge is not something they agreed to in advance. Every amount computed here becomes
 * its own row — a fare adjustment, a cancellation charge, or a ledger penalty — which is also
 * what keeps "why was I charged this" answerable line by line.
 *
 * Pure, like the rest of `pricing`. The clocks are passed in, never read.
 */

import type { BookingStatus } from '@driverzone/contracts';

// ─── Waiting, which is also the customer's late fee ──────────────────────────────────────────

export interface WaitingConfig {
  freeMinutes: number;
  chargePerMinutePaise: number;
  maxChargePaise: number;
}

export interface WaitingCharge {
  /** Whole minutes from the driver arriving to the trip starting. */
  waitedMinutes: number;
  /** The chargeable remainder after the free window. */
  chargeableMinutes: number;
  amountPaise: number;
  /** True when the cap bit, which is worth showing on a receipt rather than leaving unexplained. */
  capped: boolean;
}

/**
 * What the customer owes for keeping the driver waiting.
 *
 * THIS IS THE CUSTOMER LATE FINE. There is not a second mechanism: a free window followed by a
 * per-minute charge already IS "free waiting, then a fine", and building both would mean two
 * clocks measuring the same gap and disagreeing at the boundary.
 *
 * The clock runs from `ARRIVED` to `STARTED`, so it can only be computed once the trip has
 * actually begun. A customer who never shows up is a no-show cancellation, not an unbounded
 * waiting charge — which is what `waiting.no_show_after_minutes` exists to trigger.
 *
 * Minutes are FLOORED. Billing a full minute for three seconds of it is the kind of small
 * unfairness that costs more in support than it earns.
 */
export function computeWaitingCharge(
  arrivedAt: Date,
  startedAt: Date,
  config: WaitingConfig,
): WaitingCharge {
  const elapsedMs = Math.max(0, startedAt.getTime() - arrivedAt.getTime());
  const waitedMinutes = Math.floor(elapsedMs / 60_000);
  const chargeableMinutes = Math.max(0, waitedMinutes - config.freeMinutes);

  const uncapped = chargeableMinutes * config.chargePerMinutePaise;
  const amountPaise = Math.min(uncapped, config.maxChargePaise);

  return {
    waitedMinutes,
    chargeableMinutes,
    amountPaise,
    capped: uncapped > config.maxChargePaise,
  };
}

// ─── The driver late fine ────────────────────────────────────────────────────────────────────

export interface DriverLateConfig {
  graceMinutes: number;
  finePaise: number;
}

export interface DriverLateFine {
  lateMinutes: number;
  amountPaise: number;
}

/**
 * What the driver owes for arriving after the customer was told they would.
 *
 * A LEDGER DEBIT AGAINST THE DRIVER, NEVER A LINE ON THE CUSTOMER'S FARE. The customer's price
 * is frozen and a late driver does not change it — which also means this fine does not
 * compensate the customer, and is not meant to. A customer genuinely inconvenienced is a
 * goodwill decision for support, not an automatic refund the system issues on a timestamp.
 *
 * Measured against `scheduledAt`, the time the customer was actually promised. Measuring against
 * assignment plus an ETA would make the fine depend on how late dispatch found anyone, which is
 * the company's failure and not the driver's.
 *
 * It is a FLAT fine, not per-minute: the settings registry defines one `driver.late_fine`, and a
 * per-minute reading would need a cap, a rate and a second key that does not exist.
 */
export function computeDriverLateFine(
  scheduledAt: Date,
  arrivedAt: Date,
  config: DriverLateConfig,
): DriverLateFine {
  const lateMs = arrivedAt.getTime() - scheduledAt.getTime();
  const lateMinutes = Math.max(0, Math.floor(lateMs / 60_000));

  return {
    lateMinutes,
    amountPaise: lateMinutes > config.graceMinutes ? config.finePaise : 0,
  };
}

// ─── Cancellation ────────────────────────────────────────────────────────────────────────────

export interface CancellationConfig {
  freeWindowSeconds: number;
  scheduledFreeUntilMinutesBefore: number;
  customerFeeEnRoutePaise: number;
  customerFeeArrivedPaise: number;
  driverPenaltyEnRoutePaise: number;
  driverPenaltyArrivedPaise: number;
}

export interface CancellationContext {
  status: BookingStatus;
  /** When the booking reached CONFIRMED — the moment the free window starts running. */
  confirmedAt: Date;
  /**
   * Whether a driver was ever assigned. Gates the blunt free window, which the ladder scopes to
   * "before assignment" — see the note at the branch that reads it.
   */
  hasBeenAssigned: boolean;
  scheduledAt: Date;
  isScheduled: boolean;
  at: Date;
}

/**
 * What the customer is charged for cancelling.
 *
 * CANCELLING IS NEVER REFUSED — there is no status here that returns "you may not". A customer
 * who cannot cancel no-shows instead, which costs a driver's whole slot AND a support ticket.
 * The fee is the deterrent, and it is readable by the customer app at `GET /customer/settings`
 * so the confirm dialog can state it before they commit. Never charge a fee they have not seen.
 *
 * The ladder only ever steps up, held that way by a cross-key invariant in `settings`.
 */
export function computeCustomerCancellationFee(
  ctx: CancellationContext,
  config: CancellationConfig,
): number {
  // Nothing has cost anyone anything yet: no driver has set off. This covers the free window and
  // the "after assignment, before departure" row of the ladder at once, so neither needs a
  // separate clock — a booking still in these states is free to cancel however long it has sat.
  const fee =
    ctx.status === 'DRIVER_EN_ROUTE'
      ? config.customerFeeEnRoutePaise
      : ctx.status === 'ARRIVED'
        ? config.customerFeeArrivedPaise
        : 0;

  if (fee === 0) return 0;

  // A scheduled booking is dispatched at T−90 but free to cancel until T−60, so a driver can
  // genuinely be en route inside the free period. The window wins: the customer was promised it,
  // and the driver's wasted trip is the cost of dispatching early.
  if (ctx.isScheduled && minutesUntil(ctx.scheduledAt, ctx.at) > config.scheduledFreeUntilMinutesBefore) {
    return 0;
  }

  /*
   * THE BLUNT FREE WINDOW APPLIES ONLY BEFORE A DRIVER IS ASSIGNED, exactly as the ladder in
   * docs/LLD/booking-lifecycle.md words it — "within 5 min of confirming, BEFORE ASSIGNMENT".
   *
   * Letting it override the later rungs looks harmless and is not: dispatch can put a driver at
   * the door inside five minutes, so a customer who cancels then would pay nothing while the
   * driver has made the whole trip for free. Since every pre-assignment status is already free
   * above, this branch is currently unreachable — that is the correct shape, not a redundancy to
   * delete, because it is what stops the window being reintroduced as an override later.
   */
  if (!ctx.hasBeenAssigned && secondsBetween(ctx.confirmedAt, ctx.at) <= config.freeWindowSeconds) {
    return 0;
  }

  return fee;
}

/**
 * What the driver is debited for cancelling. Separate from the acceptance-rate consequence,
 * which is a metric rather than money and is the dispatch module's business.
 *
 * There is no free window on this side: a driver who accepts and drops the trip has already
 * taken it out of dispatch, whatever the clock says.
 */
export function computeDriverCancellationPenalty(
  status: BookingStatus,
  config: CancellationConfig,
): number {
  if (status === 'DRIVER_EN_ROUTE') return config.driverPenaltyEnRoutePaise;
  if (status === 'ARRIVED') return config.driverPenaltyArrivedPaise;
  return 0;
}

function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

function minutesUntil(target: Date, from: Date): number {
  return Math.floor((target.getTime() - from.getTime()) / 60_000);
}
