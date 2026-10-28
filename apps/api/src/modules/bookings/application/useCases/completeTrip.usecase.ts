import type { BookingPaymentMode, ExtrasCollection } from '@driverzone/contracts';
import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { SettingsReadContract } from '../../../settings/settings.public.js';
import type { LedgerWriteContract, NewLedgerEntry } from '../../../ledger/ledger.public.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import { isCaptured, type PaymentsContract } from '../../../payments/payments.public.js';
import type { DriverStatsContract } from '../../../identity/identity.public.js';
import type { WalletPublicContract } from '../../../wallet/wallet.public.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { ChargeRepositoryPort } from '../../domain/chargeRepository.port.js';
import type { ExtensionRepositoryPort } from '../../domain/extensionRepository.port.js';
import { extensionLabel, totalExtension } from '../../domain/bookingExtension.entity.js';
import { explainLostTransition, loadForDriver } from '../bookingAccess.js';
import { waitingChargeFor } from '../tripWaiting.js';

export interface CompleteTripInput {
  bookingId: string;
  driverId: string;
  actualDistanceM?: number | undefined;
  /** Cash the driver actually took, on a CASH booking. Ignored on a prepaid one. */
  cashCollectedPaise?: number | undefined;
  /**
   * How the driver settled the extras. Omitted (an older driver app) means what each mode always
   * meant — see `defaultExtrasCollection`.
   */
  extrasCollection?: ExtrasCollection | undefined;
  idempotencyKey: string;
}

/**
 * What an omitted `extrasCollection` means, per payment mode — the behaviour an older driver app
 * has always had, so it keeps working unchanged:
 *
 *   - UPI: charged online at the end (the original settlement).
 *   - CASH: taken at the door with the fare.
 *   - PREPAID: UNPAID. An older driver app does not know a trip can be prepaid, so "collected in
 *     cash" would be a guess — and guessing wrong books the driver as holding money they never
 *     took. Left as the customer's dues, a wrong guess is visible and cheap to correct.
 */
function defaultExtrasCollection(mode: BookingPaymentMode): ExtrasCollection {
  if (mode === 'UPI') return 'ONLINE';
  if (mode === 'CASH') return 'CASH';
  return 'UNPAID';
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
    /** The CUSTOMER wallet, where an old cancellation fee taken in cash is marked collected. */
    private readonly wallet?: WalletPublicContract,
  ) {}

  async execute(input: CompleteTripInput): Promise<CompletedTrip> {
    const booking = await loadForDriver(this.repo, input.bookingId, input.driverId);

    if (booking.paymentMode === null) {
      throw AppError.conflict(
        'The customer has not chosen how to pay yet. Ask them to select a payment method in their app before you can end the trip.',
      );
    }
    /*
     * WHAT A DRIVER'S PAYMENT QR ALREADY COLLECTED of the waiting charge, and which payment did it.
     * The QR charges the whole trip up front (`DriverPaymentQrUseCase`), waiting included — so
     * the waiting charge computed below must not be asked for a second time.
     */
    let prepaidWaitingPaise = 0;
    let qrPaymentId: string | null = null;

    if (booking.paymentMode === 'UPI') {
      const payments = await this.payments.listForBooking(booking.id);
      /*
       * ANY captured fare payment, not the first one. A trip can carry the customer's own online
       * order AND the driver's QR; whichever was actually paid is the one that lets the trip end.
       * Reading only the first row meant an abandoned order ahead of a paid QR blocked the trip.
       */
      const settled = payments.filter((p) => p.kind === 'BOOKING' && isCaptured(p.status));
      if (settled.length === 0) {
        throw AppError.conflict(
          "Waiting for the customer's online payment to go through. You can end the trip once it clears.",
        );
      }

      const qr = settled.filter((p) => p.channel === 'QR');
      prepaidWaitingPaise = Math.max(0, ...qr.map((p) => p.metadata['waitingPaise'] ?? 0));
      qrPaymentId = qr[0]?.id ?? null;
    }

    const collection = input.extrasCollection ?? defaultExtrasCollection(booking.paymentMode);

    /*
     * ONLINE MEANS THE GATEWAY, which only a UPI trip has an order with. On a cash or prepaid trip
     * there is nothing to charge the extras to at the end — the customer pays an extra day online
     * from their app while the trip runs (`PayTripExtrasUseCase`), and anything still owed at the
     * end is cash or dues.
     */
    if (collection === 'ONLINE' && booking.paymentMode !== 'UPI') {
      throw AppError.badRequest(
        'Online settlement is only for trips paid online. Choose cash, or mark it unpaid.',
      );
    }

    /*
     * THE SAME GATE THE FARE HAS, for the extra days — but only for an OLDER driver app, which
     * sends no `extrasCollection` and has no other way to say what happened to the money.
     *
     * A driver app that sends one has answered the question this gate was asking: the extra day
     * was taken in cash, or is left as the customer's dues. Both end the trip with the money
     * accounted for, which is what the gate existed to guarantee — so cash is never refused
     * (2026-10-13). Without the gate on the old path, a customer who paid for the trip and then
     * bought a day simply never paid for the day.
     *
     * Read BEFORE the transition: this has to refuse the completion, and a check after the status
     * has moved to COMPLETED can only complain about it.
     */
    if (input.extrasCollection === undefined && booking.paymentMode === 'UPI') {
      const agreed = totalExtension(await this.extensions.listForBooking(booking.id));
      if (agreed.amountPaise - booking.paidExtensionPaise > 0) {
        throw AppError.conflict(
          'Your customer still has to pay for the extra day. You can end the trip once that clears.',
        );
      }
    }

    const now = new Date();
    const snapshot = await this.settings.snapshot();

    /*
     * The waiting clock: ARRIVED to STARTED. Free minutes first, then per minute, capped.
     *
     * This one mechanism IS the customer late fine — a free window followed by a per-minute
     * charge already is "free waiting, then a fine", and building a second concept would mean two
     * clocks measuring the same gap and disagreeing at the boundary.
     */
    const waiting = waitingChargeFor(booking, snapshot);

    /*
     * Every extra day the driver actually agreed to. DECLINED and EXPIRED requests are excluded by
     * `totalExtension`, so a customer who asked three times and was told yes once pays for one.
     *
     * Read BEFORE the transition, so that how the extras were settled can be written in the same
     * update that completes the trip. It cannot move between here and there: an extension needs a
     * STARTED trip and the driver's own acceptance, and the driver is the one ending it.
     */
    const extras = totalExtension(await this.extensions.listForBooking(booking.id));

    /*
     * WHAT IS STILL OWED for the extras at the door.
     *
     * `paidExtensionPaise` is the extra day already collected — folded into the UPI order at
     * payment selection, paid online through the extras order, or taken in cash mid-trip
     * (`CollectExtrasInCashUseCase` bumps it too). Not on a CASH trip, where the driver takes the
     * whole extension with the fare at the end and `expectedCashPaise` already counts all of it.
     */
    const collectedExtrasPaise = booking.paymentMode === 'CASH' ? 0 : booking.paidExtensionPaise;
    const uncollectedExtrasPaise = Math.max(0, extras.amountPaise - collectedExtrasPaise);
    // `max(0, …)`: the waiting charge is computed from the same clock and settings the QR used, but
    // an admin changing the rate in between must never turn "already paid" into a negative debt.
    const uncollectedWaitingPaise = Math.max(0, waiting.amountPaise - prepaidWaitingPaise);
    const owedPaise = uncollectedWaitingPaise + uncollectedExtrasPaise;

    const completed = await this.repo.transition({
      bookingId: booking.id,
      from: 'STARTED',
      to: 'COMPLETED',
      actor: { type: 'DRIVER', id: input.driverId },
      metadata: {
        ...(input.actualDistanceM === undefined ? {} : { actualDistanceM: input.actualDistanceM }),
        waitedMinutes: waiting.waitedMinutes,
        ...(owedPaise > 0 ? { extrasCollection: collection, extrasOwedPaise: owedPaise } : {}),
      },
      patch: {
        completedAt: now,
        waitingMinutes: waiting.waitedMinutes,
        waitingChargePaise: waiting.amountPaise,
        // Recorded only when there was something to settle — "collected in cash" on a trip with
        // no extras would be a claim about money that never existed.
        ...(owedPaise > 0 ? { extrasCollection: collection } : {}),
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
     * THREE WAYS TO SETTLE what is still owed (`owedPaise`, worked out above):
     *
     *   ONLINE — one gateway charge for waiting and extensions together. `settle-${booking.id}` is
     *     derived from the booking so a retried completion cannot charge twice, which is also why
     *     it must be ONE charge: two under that key would silently collect only the first.
     *   CASH — the driver took it at the door. On a cash trip it is part of the fare's cash; on a
     *     UPI or prepaid trip it is its own `CASH_COLLECTED` row in the ledger below.
     *   UNPAID — the trip ends anyway and the amount becomes the customer's dues
     *     (`UNPAID_TRIP_CHARGE`), added to their next trip. A trip can always be ended.
     *
     * The adjustment rows above record the FULL extension either way — a receipt has to explain
     * the charge whoever collected it.
     */
    // Everything this trip cost was in the driver's QR: the adjustment rows are paid, and by which
    // payment — the same record the online settlement below writes for an extras order.
    if (owedPaise === 0 && qrPaymentId !== null && (waiting.amountPaise > 0 || extras.amountPaise > 0)) {
      await this.charges.markAdjustmentsSettled(booking.id, qrPaymentId);
    }

    if (owedPaise > 0) {
      if (collection === 'ONLINE') {
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
      } else if (collection === 'CASH') {
        // The driver took it at the door, so it is already collected.
        settledPaise = owedPaise;
      } else if (this.wallet) {
        try {
          await this.wallet.append([
            {
              customerId: booking.customerId,
              bookingId: booking.id,
              entryType: 'UNPAID_TRIP_CHARGE',
              amountPaise: -owedPaise,
              note: `Unpaid extras on trip ${booking.reference}`,
            },
          ]);
        } catch (error) {
          logger.error(
            { err: error, bookingId: booking.id, amountPaise: owedPaise },
            'trip extras were left unpaid but could NOT be recorded as customer dues',
          );
        }
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
      // Extras left UNPAID were not taken at the door, so the expected cash is the fare alone.
      const extrasInCash = collection === 'UNPAID' ? 0 : waiting.amountPaise + extras.amountPaise;
      const collected = input.cashCollectedPaise ?? expectedCashPaise(booking, extrasInCash);

      entries.push({
        driverId: input.driverId,
        bookingId: booking.id,
        entryType: 'CASH_COLLECTED',
        amountPaise: -Math.abs(collected),
        note: `Cash collected for ${booking.reference}`,
      });
    } else if (booking.cashExtensionPaise > 0) {
      /*
       * A UPI TRIP WHERE ONLY THE EXTRA DAY CHANGED HANDS IN CASH — `CollectExtrasInCashUseCase`,
       * the way out of the extension gate when the customer's phone is dead. The fare reached the
       * company through the gateway; this did not, so the driver is holding the company's share of
       * it and the same negative row a cash fare gets applies to exactly this portion.
       *
       * An `else if`: on an all-cash trip the row above already covers the extension, and adding
       * this one would book the same money twice.
       */
      entries.push({
        driverId: input.driverId,
        bookingId: booking.id,
        entryType: 'CASH_COLLECTED',
        amountPaise: -Math.abs(booking.cashExtensionPaise),
        note: `Extra day collected in cash for ${booking.reference}`,
      });
    }

    /*
     * EXTRAS TAKEN IN CASH AT THE END of a UPI or prepaid trip — waiting, and any extra day still
     * owed. The fare reached the company another way; this money is in the driver's pocket, so it
     * is the company's and comes back as a negative row, like a cash fare. Separate from the
     * mid-trip `cashExtensionPaise` row above, which `owedPaise` already excludes, so nothing is
     * counted twice.
     */
    if (booking.paymentMode !== 'CASH' && collection === 'CASH' && owedPaise > 0) {
      entries.push({
        driverId: input.driverId,
        bookingId: booking.id,
        entryType: 'CASH_COLLECTED',
        amountPaise: -owedPaise,
        note: `Extras collected in cash for ${booking.reference}`,
      });
    }

    try {
      await this.ledger.append(entries);
    } catch (error) {
      logger.error({ err: error, bookingId: booking.id }, 'could not write the trip ledger entries');
    }

    /*
     * AN OLD CANCELLATION FEE TAKEN IN CASH — a customer choosing cash while they owe one (allowed
     * since 2026-10-13), or the driver's payment override. The driver took the fee
     * with the fare (it is in `expectedCashPaise` and in the `CASH_COLLECTED` row above), so the
     * debt is now collected: the same `DEBT_COLLECTED` row an online capture writes, and
     * once-per-booking in the wallet, so a retried completion cannot clear it twice.
     */
    if (booking.paymentMode === 'CASH' && booking.walletDebtPaise > 0 && this.wallet) {
      try {
        await this.wallet.append([
          {
            customerId: booking.customerId,
            bookingId: booking.id,
            entryType: 'DEBT_COLLECTED',
            amountPaise: booking.walletDebtPaise,
            note: `Collected in cash with trip ${booking.reference}`,
          },
        ]);
      } catch (error) {
        logger.error(
          { err: error, bookingId: booking.id, debtPaise: booking.walletDebtPaise },
          'old cancellation fee was collected in cash but NOT marked collected on the wallet',
        );
      }
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
      /*
       * What the customer has ACTUALLY paid — `settledPaise` stays 0 when the settlement charge
       * failed or the extras were left unpaid, and that must keep showing through here.
       * `collectedExtrasPaise` is added because that money moved earlier (payment selection, the
       * extras order, or cash mid-trip), so it is neither in the frozen fare nor in this settlement.
       */
      totalPaise: booking.fareSnapshot.fare.totalPaise + settledPaise + collectedExtrasPaise,
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
    booking.fareSnapshot.fare.totalPaise +
      extrasPaise -
      booking.walletCreditPaise +
      // An old cancellation fee, collected at the door — only on a driver's payment override.
      booking.walletDebtPaise,
  );
}
