import { logger } from '../../../../shared/logging/logger.js';
import { rupeesToPaise, type SettingsReadContract } from '../../../settings/settings.public.js';
import { computeWaitingCharge } from '../../../pricing/pricing.public.js';
import type { LedgerWriteContract, NewLedgerEntry } from '../../../ledger/ledger.public.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { PaymentsContract } from '../../../payments/payments.public.js';
import type { DriverStatsContract } from '../../../identity/identity.public.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { ChargeRepositoryPort } from '../../domain/chargeRepository.port.js';
import type { ExtensionRepositoryPort } from '../../domain/extensionRepository.port.js';
import { extensionLabel, totalExtension } from '../../domain/bookingExtension.entity.js';
import { explainLostTransition, loadForDriver } from '../bookingAccess.js';

export interface CompleteTripInput {
  bookingId: string;
  driverId: string;
  actualDistanceM?: number | undefined;
  /** Cash the driver actually took, on a CASH booking. Ignored on a prepaid one. */
  cashCollectedPaise?: number | undefined;
  idempotencyKey: string;
}

export interface CompletedTrip {
  booking: Booking;
  waitingChargePaise: number;
  /** Total the customer has now paid, fare plus any settled extras. */
  totalPaise: number;
}

/**
 * Ends the trip and settles everything that accrued during it.
 *
 * THERE IS NO FINAL-FARE RECOMPUTE. A 3-hour booking that runs 3h 40m costs what the customer was
 * told — overage billing was deleted on 2026-08-28 along with the rates it read. The only money
 * decided here is the waiting charge, which was incurred BEFORE the trip started and is a
 * separate row from the frozen fare (invariant B-1).
 *
 * EVERY SIDE EFFECT IS IDEMPOTENT, because they run after the status transition has committed and
 * a crash anywhere in the middle means the whole handler is retried. The adjustment row, the
 * settlement payment and the ledger entries each have their own uniqueness guard.
 */
export class CompleteTripUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly charges: ChargeRepositoryPort,
    private readonly settings: SettingsReadContract,
    private readonly ledger: LedgerWriteContract,
    private readonly payments: PaymentsContract,
    private readonly notifications: NotificationsContract,
    /** Extra days the customer bought mid-trip and the driver agreed to. Settled here, not then. */
    private readonly extensions: ExtensionRepositoryPort,
    private readonly driverStats?: DriverStatsContract,
  ) {}

  async execute(input: CompleteTripInput): Promise<CompletedTrip> {
    const booking = await loadForDriver(this.repo, input.bookingId, input.driverId);
    const now = new Date();
    const snapshot = await this.settings.snapshot();

    /*
     * The waiting clock: ARRIVED to STARTED. Free minutes first, then per minute, capped.
     *
     * This one mechanism IS the customer late fine — a free window followed by a per-minute
     * charge already is "free waiting, then a fine", and building a second concept would mean two
     * clocks measuring the same gap and disagreeing at the boundary.
     */
    const waiting =
      booking.arrivedAt !== null && booking.startedAt !== null
        ? computeWaitingCharge(booking.arrivedAt, booking.startedAt, {
            freeMinutes: snapshot['waiting.free_minutes'],
            chargePerMinutePaise: rupeesToPaise(snapshot['waiting.charge_per_minute']),
            maxChargePaise: rupeesToPaise(snapshot['waiting.max_charge']),
          })
        : { waitedMinutes: 0, chargeableMinutes: 0, amountPaise: 0, capped: false };

    const completed = await this.repo.transition({
      bookingId: booking.id,
      from: 'STARTED',
      to: 'COMPLETED',
      actor: { type: 'DRIVER', id: input.driverId },
      metadata: {
        ...(input.actualDistanceM === undefined ? {} : { actualDistanceM: input.actualDistanceM }),
        waitedMinutes: waiting.waitedMinutes,
      },
      patch: {
        completedAt: now,
        waitingMinutes: waiting.waitedMinutes,
        waitingChargePaise: waiting.amountPaise,
      },
    });

    if (completed === null) return explainLostTransition(this.repo, booking, 'COMPLETED');

    /*
     * Every extra day the driver actually agreed to. DECLINED and EXPIRED requests are excluded by
     * `totalExtension`, so a customer who asked three times and was told yes once pays for one.
     *
     * Read AFTER the transition, like the waiting charge: by this point the trip is over and no
     * further extension can be accepted, so the sum cannot move underneath the settlement.
     */
    const extras = totalExtension(await this.extensions.listForBooking(booking.id));

    // ── Settle the extras ───────────────────────────────────────────────────────────────────
    let settledPaise = 0;

    /*
     * A cash trip settles its extras in cash too — the driver takes fare plus waiting at the end —
     * so there is no second Razorpay charge. The adjustment row is still written, because a
     * receipt has to explain the extra either way.
     */
    const settleThroughGateway = booking.paymentMode === 'UPI';

    if (waiting.amountPaise > 0) {
      await this.charges.recordAdjustment({
        bookingId: booking.id,
        type: 'WAITING_CHARGE',
        amountPaise: waiting.amountPaise,
        label: `Waiting — ${waiting.chargeableMinutes} min beyond the free ${snapshot['waiting.free_minutes']}`,
      });
    }

    /*
     * ONE ROW HOLDING THE TOTAL, which the `{ bookingId, type }` unique index requires and the
     * receipt wants anyway — "Extended — 2 extra days" reads better than two identical lines. The
     * individual days, each with the driver's answer against it, are in `bookingExtensions`.
     */
    if (extras.amountPaise > 0) {
      await this.charges.recordAdjustment({
        bookingId: booking.id,
        type: 'DAY_EXTENSION',
        amountPaise: extras.amountPaise,
        label: extensionLabel(extras.days),
      });
    }

    /*
     * ONE SETTLEMENT FOR BOTH, and it has to be one. `settle-${booking.id}` is derived from the
     * booking precisely so a retried completion cannot charge twice — which means two separate
     * charges under that key would silently collect only the first. Waiting and extensions are
     * summed and taken together.
     */
    const owedPaise = waiting.amountPaise + extras.amountPaise;

    if (owedPaise > 0) {
      if (settleThroughGateway) {
        try {
          const { payment } = await this.payments.charge({
            bookingId: booking.id,
            customerId: booking.customerId,
            kind: 'SETTLEMENT',
            amountPaise: owedPaise,
            reference: booking.reference,
            // Derived from the booking, not from the request: a retry with a fresh client key must
            // not become a second charge for the same extras. Hyphen, not a colon — the gateway's
            // idempotency charset excludes it.
            idempotencyKey: `settle-${booking.id}`,
          });

          await this.charges.markAdjustmentsSettled(booking.id, payment.id);
          settledPaise = owedPaise;
        } catch (error) {
          // The trip is over and the driver is owed regardless. An uncollected settlement is a
          // receivable to chase, not a reason to fail the completion.
          logger.error(
            { err: error, bookingId: booking.id, amountPaise: owedPaise },
            'could not collect the trip extras — recorded as owed',
          );
        }
      } else {
        // Cash: the driver took it at the door along with the fare, so it is already collected.
        settledPaise = owedPaise;
      }
    }

    // ── The ledger ──────────────────────────────────────────────────────────────────────────
    const { split } = booking.fareSnapshot.fare;
    const entries: NewLedgerEntry[] = [
      {
        driverId: input.driverId,
        bookingId: booking.id,
        entryType: 'TRIP_EARNING',
        // From the FROZEN snapshot, never the live package: a rate changed since the booking was
        // made must not alter what was owed on it.
        amountPaise: split.driverPaise,
        // The reference, not the id: `ledger` is four tiers below `bookings` and cannot look up a
        // `DZ-…` for the admin wallet screen, so the caller that knows it says so here.
        note: `Trip ${booking.reference}`,
      },
    ];

    /*
     * COMMISSIONED, unlike the waiting earning below it. An extra day is a day of the package, so
     * the driver gets the same per-day share they were promised when the booking was priced —
     * frozen onto the extension row at request time, never re-read from the package here.
     */
    if (extras.driverAmountPaise > 0) {
      entries.push({
        driverId: input.driverId,
        bookingId: booking.id,
        entryType: 'EXTENSION_EARNING',
        amountPaise: extras.driverAmountPaise,
        note: `${String(extras.days)} extra ${extras.days === 1 ? 'day' : 'days'} on ${booking.reference}`,
      });
    }

    if (waiting.amountPaise > 0) {
      entries.push({
        driverId: input.driverId,
        bookingId: booking.id,
        entryType: 'WAITING_EARNING',
        /*
         * IN FULL, UNCOMMISSIONED. It compensates the driver's time and the company did nothing
         * to earn a share of it. This is the line that carries that decision.
         */
        amountPaise: waiting.amountPaise,
        note: `Waiting ${waiting.chargeableMinutes} min on ${booking.reference}`,
      });
    }

    /*
     * CASH: the driver is now holding the company's money.
     *
     * NEGATIVE, and it is the entry that makes a driver's balance go into debt at all — they took
     * the whole fare but earned only their share of it. This is what `driver.max_negative_balance`
     * measures and what `MongoDriverPool` already filters dispatch on, so an unsettled driver
     * stops being offered work without a line of new dispatch code.
     *
     * The amount is what the DRIVER reports collecting, not what we think the fare was: if those
     * disagree, the ledger should record the real movement of money and let reconciliation find
     * the gap, rather than quietly booking a number nobody handed over.
     */
    if (booking.paymentMode === 'CASH') {
      const collected =
        input.cashCollectedPaise ??
        expectedCashPaise(booking, waiting.amountPaise + extras.amountPaise);

      entries.push({
        driverId: input.driverId,
        bookingId: booking.id,
        entryType: 'CASH_COLLECTED',
        amountPaise: -Math.abs(collected),
        note: `Cash collected for ${booking.reference}`,
      });
    }

    try {
      await this.ledger.append(entries);
    } catch (error) {
      logger.error({ err: error, bookingId: booking.id }, 'could not write the trip ledger entries');
    }

    if (this.driverStats) {
      try {
        await this.driverStats.recordCompletedRide(input.driverId, now);
      } catch (error) {
        logger.error({ err: error, driverId: input.driverId }, 'could not record driver trip stats');
      }
    }

    await this.notifications.sendBookingUpdate(
      { role: 'CUSTOMER', id: booking.customerId },
      {
        bookingId: booking.id,
        reference: booking.reference,
        status: 'COMPLETED',
        message: 'Your trip is complete. Thank you for riding with DriverZone.',
      },
    );

    return {
      booking: completed,
      waitingChargePaise: waiting.amountPaise,
      totalPaise: booking.fareSnapshot.fare.totalPaise + settledPaise,
    };
  }
}

/**
 * What a cash trip should have collected: the frozen fare, plus whatever accrued during the trip
 * — waiting time and any extra days the driver agreed to — LESS the customer's wallet credit.
 *
 * THE EXTRAS ARE ONE ARGUMENT, not two, because this function has no reason to tell them apart:
 * both are money the driver takes at the door on top of the fare, and summing them at the call
 * site keeps the one place that decides what a cash driver collects from growing a parameter per
 * kind of charge.
 *
 * THE CREDIT COMES OFF THE DOOR, and that is the whole reason a cash trip can use a wallet at
 * all. The driver is told the reduced figure and hands over the reduced figure, so this is what
 * the `CASH_COLLECTED` row must say — a driver who collected ₹450 on a ₹500 fare and is recorded
 * as holding ₹500 owes the company ₹50 they never took.
 *
 * `walletCreditPaise` is read off the BOOKING rather than from the wallet, because the balance
 * has moved on since and only the frozen figure describes this trip.
 *
 * A fallback for a driver app that completes without reporting a figure. It is the EXPECTED
 * amount, not an observed one — which is why the reported number wins when there is one, and why
 * a mismatch is worth surfacing to ops rather than smoothing over here.
 */
function expectedCashPaise(booking: Booking, extrasPaise: number): number {
  return Math.max(
    0,
    booking.fareSnapshot.fare.totalPaise + extrasPaise - booking.walletCreditPaise,
  );
}
