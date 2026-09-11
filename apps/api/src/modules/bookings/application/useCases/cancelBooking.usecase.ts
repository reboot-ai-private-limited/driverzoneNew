import { logger } from '../../../../shared/logging/logger.js';
import { rupeesToPaise, type SettingsReadContract } from '../../../settings/settings.public.js';
import {
  computeCustomerCancellationFee,
  computeDriverCancellationPenalty,
  type CancellationConfig,
} from '../../../pricing/pricing.public.js';
import type { LedgerWriteContract } from '../../../ledger/ledger.public.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { PaymentsContract } from '../../../payments/payments.public.js';
import type { WalletPublicContract } from '../../../wallet/wallet.public.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { ChargeRepositoryPort } from '../../domain/chargeRepository.port.js';
import { canTransition } from '../../domain/booking.entity.js';
import { BookingNotFoundError, InvalidTransitionError } from '../../domain/booking.errors.js';
import {
  explainLostTransition,
  loadForCustomer,
  loadForDriver,
  requireReason,
} from '../bookingAccess.js';

export interface CancelInput {
  bookingId: string;
  actorId: string;
  reason: string | undefined;
}

export interface CancelResult {
  booking: Booking;
  /** What the customer was charged, or what the driver was debited. */
  feePaise: number;
  refundedPaise: number;
}

function configFrom(snapshot: Awaited<ReturnType<SettingsReadContract['snapshot']>>): CancellationConfig {
  return {
    freeWindowSeconds: snapshot['cancellation.free_window_seconds'],
    scheduledFreeUntilMinutesBefore: snapshot['cancellation.scheduled_free_until_minutes_before'],
    customerFeeEnRoutePaise: rupeesToPaise(snapshot['cancellation.customer_fee_en_route']),
    customerFeeArrivedPaise: rupeesToPaise(snapshot['cancellation.customer_fee_arrived']),
    driverPenaltyEnRoutePaise: rupeesToPaise(snapshot['cancellation.driver_penalty_en_route']),
    driverPenaltyArrivedPaise: rupeesToPaise(snapshot['cancellation.driver_penalty_arrived']),
  };
}

/**
 * A customer cancels.
 *
 * CANCELLING IS NEVER REFUSED, at any status the table allows. A customer who cannot cancel
 * no-shows instead, which costs a driver's whole slot AND a support ticket; the fee is the
 * deterrent. Every threshold is readable by the app at `GET /customer/settings`, so the confirm
 * dialog states the fee before they commit — never charge a fee the customer has not seen.
 *
 * The fee is KEPT FROM THE REFUND rather than charged separately: the money is already ours, and
 * a second collection from a customer who is walking away is a collection that will fail.
 */
export class CancelBookingByCustomerUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly charges: ChargeRepositoryPort,
    private readonly settings: SettingsReadContract,
    private readonly payments: PaymentsContract,
    /** Where an uncollected fee becomes the debt the customer's next trip carries. */
    private readonly wallet: WalletPublicContract,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(input: CancelInput): Promise<CancelResult> {
    const booking = await loadForCustomer(this.repo, input.bookingId, input.actorId);
    const reason = requireReason(input.reason);
    const now = new Date();

    const snapshot = await this.settings.snapshot();
    const feePaise = computeCustomerCancellationFee(
      {
        status: booking.status,
        // A booking never confirmed has no fee anyway, so the fallback is only ever a formality.
        confirmedAt: booking.createdAt,
        hasBeenAssigned: booking.assignedAt !== null,
        scheduledAt: booking.scheduledAt,
        isScheduled: booking.isScheduled,
        at: now,
      },
      configFrom(snapshot),
    );

    const cancelled = await this.repo.transition({
      bookingId: booking.id,
      from: booking.status,
      to: 'CANCELLED_BY_CUSTOMER',
      actor: { type: 'CUSTOMER', id: input.actorId },
      reason,
      metadata: { feePaise, atStatus: booking.status },
      patch: { cancelledAt: now, cancellationReason: reason },
    });

    if (cancelled === null) {
      return explainLostTransition(this.repo, booking, 'CANCELLED_BY_CUSTOMER');
    }

    /*
     * WHO IS HOLDING THE MONEY DECIDES WHETHER THIS IS COLLECTED OR MERELY OWED.
     *
     * On a prepaid booking the fee is kept back out of the refund, so charging and collecting are
     * the same act and the row is settled the moment it is written. On a CASH booking we hold
     * nothing — the row stays unsettled and becomes a debt that the customer's next UPI booking
     * clears, which is the only leverage left once the trip is gone.
     */
    const refundedPaise = await this.refund(booking, feePaise);

    if (feePaise > 0) {
      const collectedNow = booking.paymentMode === 'UPI' && booking.paymentId !== null;

      await this.charges.recordCancellationCharge({
        bookingId: booking.id,
        customerId: booking.customerId,
        chargedTo: 'CUSTOMER',
        amountPaise: feePaise,
        atStatus: booking.status,
        reason,
        ...(collectedNow && booking.paymentId !== null
          ? { settledByPaymentId: booking.paymentId }
          : {}),
      });

      /*
       * AND INTO THE WALLET, but only when it was not collected on the spot.
       *
       * The charge row above is the AUDIT — what was levied, at which status, and why. The wallet
       * row is the DEBT, and the two are deliberately not the same record: a prepaid fee that was
       * kept out of its own refund is fully settled and must never appear as an outstanding
       * balance, while a cash one has nothing behind it and becomes what the next trip collects.
       *
       * Once-per-booking, so a retried cancellation cannot charge it twice. Logged rather than
       * thrown because the booking is already cancelled — failing here would leave the customer
       * with a cancelled trip and an error, and the fee is recoverable from the charge row.
       */
      if (!collectedNow) {
        try {
          await this.wallet.append([
            {
              customerId: booking.customerId,
              bookingId: booking.id,
              entryType: 'CANCELLATION_FEE',
              amountPaise: -feePaise,
              note: `Cancellation fee for trip ${booking.reference}`,
            },
          ]);
        } catch (error) {
          logger.error(
            { err: error, bookingId: booking.id },
            'could not record the cancellation fee on the wallet',
          );
        }
      }
    }

    if (booking.driverId !== null) {
      await this.notifications.sendBookingUpdate(
        { role: 'DRIVER', id: booking.driverId },
        {
          bookingId: booking.id,
          reference: booking.reference,
          status: 'CANCELLED_BY_CUSTOMER',
          message: 'The customer has cancelled this trip.',
        },
      );
    }

    return { booking: cancelled, feePaise, refundedPaise };
  }

  /** Everything paid, less the fee. Nothing at all if the fee swallows the fare — or if cash. */
  private async refund(booking: Booking, feePaise: number): Promise<number> {
    return refundLessFee(this.payments, booking, feePaise);
  }
}

/**
 * Everything paid, less whatever fee was kept back.
 *
 * MODULE-LEVEL RATHER THAN A METHOD, because the admin cancellation below needs exactly this with
 * a fee of zero. Copying it there would be two refund paths that have to stay in step on the
 * idempotency key, the CAPTURED check and what a gateway failure means — and they would not.
 *
 * A FAILURE HERE IS LOGGED, NEVER THROWN. By the time this runs the booking is already cancelled
 * and the driver already released; an unpaid refund is a receivable for ops to chase, not a
 * reason to leave a dead trip live.
 */
async function refundLessFee(
  payments: PaymentsContract,
  booking: Booking,
  feePaise: number,
): Promise<number> {
  // Nothing was collected, so there is nothing to send back. The fee becomes a due instead.
  if (booking.paymentMode === 'CASH' || booking.paymentId === null) return 0;

  const payment = await payments.findById(booking.paymentId);
  if (payment === null || payment.status !== 'CAPTURED') return 0;

  const refundable = payment.amountPaise - feePaise;
  if (refundable <= 0) return 0;

  try {
    await payments.refund({
      paymentId: payment.id,
      amountPaise: refundable,
      // HYPHEN, not a colon: Razorpay's `X-Refund-Idempotency` accepts `[A-Za-z0-9_-]` only,
      // and rejects the request outright otherwise. The adapter sanitises too; this is the
      // call site being correct rather than relying on it.
      idempotencyKey: `refund-${booking.id}`,
    });
    return refundable;
  } catch (error) {
    logger.error(
      { err: error, bookingId: booking.id, refundable },
      'cancellation refund failed — booking is cancelled, refund is owed',
    );
    return 0;
  }
}

/**
 * A driver drops a trip they had accepted.
 *
 * NO FREE WINDOW on this side: a driver who accepts has already taken the booking out of dispatch,
 * whatever the clock says. The penalty is a ledger debit; the acceptance-rate consequence is a
 * metric and belongs to `dispatch`.
 *
 * The customer is refunded in full — they did nothing wrong — and the booking returns to
 * `SEARCHING` rather than dying, because a driver cancelling is our problem to solve, not theirs.
 */
export class CancelBookingByDriverUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly charges: ChargeRepositoryPort,
    private readonly settings: SettingsReadContract,
    private readonly ledger: LedgerWriteContract,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(input: CancelInput): Promise<CancelResult> {
    const booking = await loadForDriver(this.repo, input.bookingId, input.actorId);
    const reason = requireReason(input.reason);
    const now = new Date();

    const snapshot = await this.settings.snapshot();
    const penaltyPaise = computeDriverCancellationPenalty(booking.status, configFrom(snapshot));

    const cancelled = await this.repo.transition({
      bookingId: booking.id,
      from: booking.status,
      to: 'CANCELLED_BY_DRIVER',
      actor: { type: 'DRIVER', id: input.actorId },
      reason,
      metadata: { penaltyPaise, atStatus: booking.status },
      patch: { cancelledAt: now, cancellationReason: reason },
    });

    if (cancelled === null) {
      return explainLostTransition(this.repo, booking, 'CANCELLED_BY_DRIVER');
    }

    if (penaltyPaise > 0) {
      await this.charges.recordCancellationCharge({
        bookingId: booking.id,
        customerId: booking.customerId,
        chargedTo: 'DRIVER',
        amountPaise: penaltyPaise,
        atStatus: booking.status,
        reason,
        // A driver's penalty is a ledger debit taken from their earnings, never a customer debt —
        // so it is settled on sight and can never appear in `outstandingDues`.
        settledByPaymentId: booking.paymentId ?? undefined,
      });

      try {
        await this.ledger.append([
          {
            driverId: input.actorId,
            bookingId: booking.id,
            entryType: 'PENALTY',
            amountPaise: -penaltyPaise,
            note: `Cancelled ${booking.reference} at ${booking.status}: ${reason}`,
          },
        ]);
      } catch (error) {
        logger.error({ err: error, bookingId: booking.id }, 'could not record the driver cancellation penalty');
      }
    }

    await this.notifications.sendBookingUpdate(
      { role: 'CUSTOMER', id: booking.customerId },
      {
        bookingId: booking.id,
        reference: booking.reference,
        status: 'CANCELLED_BY_DRIVER',
        message: 'Your driver had to cancel. We are sorry — please book again and we will find you another.',
      },
    );

    return { booking: cancelled, feePaise: penaltyPaise, refundedPaise: 0 };
  }
}

/**
 * An ADMIN cancels a booking.
 *
 * NOBODY IS CHARGED. Not the customer, not the driver — and that is the whole reason this is its
 * own class rather than a flag on the two above. An admin cancellation is the company deciding a
 * trip is not going to happen: there is no misbehaviour to deter on either side, so there is no
 * fee ladder to read, no charge row to write, no wallet debt to leave behind, and no ledger
 * penalty. Every one of those is a line this class does not have.
 *
 * THE CUSTOMER IS REFUNDED IN FULL, through the same helper the customer cancellation uses with a
 * fee of zero. Cash bookings refund nothing because nothing was ever collected.
 *
 * THE REASON IS MANDATORY and it is passed on to both parties verbatim. A trip that vanishes with
 * no explanation is a support call from the customer and a second one from the driver, which is
 * exactly the work ops was trying to save by cancelling it here.
 *
 * NO ACTOR CHECK BEYOND THE ROUTE. Unlike the customer and driver cases there is no
 * `loadForCustomer`/`loadForDriver` — an admin is not a party to the booking, and
 * `requireAuth('ADMIN')` on the router is the whole authorisation. `actorId` is recorded on the
 * event so the history names which admin did it.
 */
export class CancelBookingByAdminUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly payments: PaymentsContract,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(input: CancelInput): Promise<CancelResult> {
    const booking = await this.repo.findById(input.bookingId);
    if (booking === null) throw new BookingNotFoundError(input.bookingId);

    const reason = requireReason(input.reason);
    const now = new Date();

    /*
     * THE TABLE IS CHECKED HERE, EXPLICITLY, and it has to be.
     *
     * Every other cancellation passes a LITERAL `from` — `'STARTED'`, `'ARRIVED'` — so the
     * compare-and-swap itself refuses anything else and the table is enforced by the caller
     * naming the one legal source status. This one is different: an admin may cancel from six
     * different statuses, so `from` is whatever the booking is in, and the swap would then match
     * ANY of them — including `COMPLETED`, which the table forbids and which would un-finish a
     * trip that has already been paid for and settled into the driver's ledger.
     */
    if (!canTransition(booking.status, 'CANCELLED_BY_ADMIN')) {
      throw new InvalidTransitionError(booking.reference, booking.status, 'CANCELLED_BY_ADMIN');
    }

    const cancelled = await this.repo.transition({
      bookingId: booking.id,
      from: booking.status,
      to: 'CANCELLED_BY_ADMIN',
      actor: { type: 'ADMIN', id: input.actorId },
      reason,
      /*
       * `feePaise: 0` is recorded EXPLICITLY rather than omitted. The event log is what answers
       * "was I charged for this" eight weeks later, and an absent field reads as "nobody wrote it
       * down" — which is the same shape as a bug that forgot to.
       */
      metadata: { feePaise: 0, atStatus: booking.status },
      patch: { cancelledAt: now, cancellationReason: reason },
    });

    if (cancelled === null) {
      return explainLostTransition(this.repo, booking, 'CANCELLED_BY_ADMIN');
    }

    const refundedPaise = await refundLessFee(this.payments, booking, 0);

    await this.notifications.sendBookingUpdate(
      { role: 'CUSTOMER', id: booking.customerId },
      {
        bookingId: booking.id,
        reference: booking.reference,
        status: 'CANCELLED_BY_ADMIN',
        message: `We have had to cancel this trip: ${reason}. You have not been charged.`,
      },
    );

    if (booking.driverId !== null) {
      await this.notifications.sendBookingUpdate(
        { role: 'DRIVER', id: booking.driverId },
        {
          bookingId: booking.id,
          reference: booking.reference,
          status: 'CANCELLED_BY_ADMIN',
          // Says the cancellation is not theirs, because the driver's own cancellation DOES carry
          // a penalty and they have no way to tell the two apart from a status alone.
          message: `This trip was cancelled by the office: ${reason}. It does not count against you.`,
        },
      );
    }

    return { booking: cancelled, feePaise: 0, refundedPaise };
  }
}
