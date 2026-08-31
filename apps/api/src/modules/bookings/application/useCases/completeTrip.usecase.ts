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

    if (waiting.amountPaise > 0) {
      await this.charges.recordAdjustment({
        bookingId: booking.id,
        type: 'WAITING_CHARGE',
        amountPaise: waiting.amountPaise,
        label: `Waiting — ${waiting.chargeableMinutes} min beyond the free ${snapshot['waiting.free_minutes']}`,
      });

      try {
        const { payment } = await this.payments.charge({
          bookingId: booking.id,
          customerId: booking.customerId,
          kind: 'SETTLEMENT',
          amountPaise: waiting.amountPaise,
          reference: booking.reference,
          // Derived from the booking, not from the request: a retry with a fresh client key must
          // not become a second charge for the same waiting time.
          idempotencyKey: `settle:${booking.id}`,
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
      });
    }

    /*
     * NO `CASH_COLLECTED` ROW. The fare was prepaid online at confirmation, so the driver is
     * holding none of the company's money. The entry type still exists for the day a cash mode
     * does; it simply never fires on this path.
     */
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
