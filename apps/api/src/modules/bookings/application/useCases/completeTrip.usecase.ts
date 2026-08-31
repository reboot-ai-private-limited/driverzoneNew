import { logger } from '../../../../shared/logging/logger.js';
import { rupeesToPaise, type SettingsReadContract } from '../../../settings/settings.public.js';
import { computeWaitingCharge } from '../../../pricing/pricing.public.js';
import type { LedgerWriteContract, NewLedgerEntry } from '../../../ledger/ledger.public.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { PaymentsContract } from '../../../payments/payments.public.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { ChargeRepositoryPort } from '../../domain/chargeRepository.port.js';
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

      if (settleThroughGateway) {
        try {
          const { payment } = await this.payments.charge({
            bookingId: booking.id,
            customerId: booking.customerId,
            kind: 'SETTLEMENT',
            amountPaise: waiting.amountPaise,
            reference: booking.reference,
            // Derived from the booking, not from the request: a retry with a fresh client key must
            // not become a second charge for the same waiting time. Hyphen, not a colon — the
            // gateway's idempotency charset excludes it.
            idempotencyKey: `settle-${booking.id}`,
          });

          await this.charges.markAdjustmentsSettled(booking.id, payment.id);
          settledPaise = waiting.amountPaise;
        } catch (error) {
          // The trip is over and the driver is owed regardless. An uncollected settlement is a
          // receivable to chase, not a reason to fail the completion.
          logger.error(
            { err: error, bookingId: booking.id, amountPaise: waiting.amountPaise },
            'could not collect the waiting charge — recorded as owed',
          );
        }
      } else {
        // Cash: the driver took it at the door along with the fare, so it is already collected.
        settledPaise = waiting.amountPaise;
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
      const collected = input.cashCollectedPaise ?? expectedCashPaise(booking, waiting.amountPaise);

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
 * What a cash trip should have collected: the frozen fare plus whatever waiting accrued.
 *
 * A fallback for a driver app that completes a trip without reporting a figure. It is the
 * EXPECTED amount, not an observed one — which is why the reported number wins when there is one,
 * and why a mismatch between them is worth surfacing to ops rather than smoothing over here.
 */
function expectedCashPaise(booking: Booking, waitingPaise: number): number {
  return booking.fareSnapshot.fare.totalPaise + waitingPaise;
}
