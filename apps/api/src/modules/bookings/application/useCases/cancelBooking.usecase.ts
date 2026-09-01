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
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { ChargeRepositoryPort } from '../../domain/chargeRepository.port.js';
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
    // Nothing was collected, so there is nothing to send back. The fee becomes a due instead.
    if (booking.paymentMode === 'CASH' || booking.paymentId === null) return 0;

    const payment = await this.payments.findById(booking.paymentId);
    if (payment === null || payment.status !== 'CAPTURED') return 0;

    const refundable = payment.amountPaise - feePaise;
    if (refundable <= 0) return 0;

    try {
      await this.payments.refund({
        paymentId: payment.id,
        amountPaise: refundable,
        // HYPHEN, not a colon: Razorpay's `X-Refund-Idempotency` accepts `[A-Za-z0-9_-]` only,
        // and rejects the request outright otherwise. The adapter sanitises too; this is the
        // call site being correct rather than relying on it.
        idempotencyKey: `refund-${booking.id}`,
      });
      return refundable;
    } catch (error) {
      // The booking IS cancelled — that has already committed, and the driver has been released.
      // An unpaid refund is a receivable for ops, not a reason to leave the trip live.
      logger.error(
        { err: error, bookingId: booking.id, refundable },
        'cancellation refund failed — booking is cancelled, refund is owed',
      );
      return 0;
    }
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
