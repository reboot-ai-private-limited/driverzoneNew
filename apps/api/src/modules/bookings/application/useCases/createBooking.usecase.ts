import { randomInt } from 'node:crypto';
import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { PaymentMode } from '@driverzone/contracts';
import type { PaymentsContract } from '../../../payments/payments.public.js';
import type { ChargeRepositoryPort } from '../../domain/chargeRepository.port.js';
import type { DispatchScheduler } from './confirmBookingPayment.usecase.js';
import type { QuoteConsumptionContract } from '../../../quotes/quotes.public.js';
import type { SettingsReadContract } from '../../../settings/settings.public.js';
import {
  generateReference,
  isScheduledBooking,
  type Booking,
  type FareSnapshot,
} from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';

export interface CreateBookingInput {
  customerId: string;
  quoteId: string;
  pickupAddress: string;
  dropAddress: string;
  paymentMode: PaymentMode;
  /** One tap, one key. Passed to the gateway so a retried request charges once. */
  idempotencyKey: string;
}

export interface CreatedBooking {
  booking: Booking;
  /** The gateway order id, for checkout. Null for cash, and null on an already-settled retry. */
  clientToken: string | null;
  /** The publishable key checkout needs beside the order. Null for cash. */
  publicKey: string | null;
  /** What is being charged: the fare plus any dues carried in. Null for cash. */
  amountPaise: number | null;
}

/**
 * Turns a quote into a booking and starts collecting for it.
 *
 * THE ORDER HERE IS THE WHOLE DESIGN, and it is not the obvious one. The booking row is created
 * BEFORE the quote is consumed and before the payment exists, because consumption needs a booking
 * id to record and because a customer must never be charged for a booking that failed to save.
 * That leaves one recoverable failure — a booking at `PENDING_PAYMENT` whose quote was never
 * claimed — which the sweeper expires. The alternative orderings lose money or lose the booking.
 *
 * IDEMPOTENT ON THE QUOTE. A double-tapped Confirm finds the quote already consumed and returns
 * the booking that consumed it, rather than creating a second at the same price.
 */
export class CreateBookingUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly quotes: QuoteConsumptionContract,
    private readonly payments: PaymentsContract,
    private readonly settings: SettingsReadContract,
    private readonly charges: ChargeRepositoryPort,
    /**
     * Only reached on the CASH path. A prepaid booking is dispatched by the payment webhook, which
     * for cash never fires — so this use case has to do it, and it is injected for the same reason
     * the webhook's copy is: `dispatch` is a tier above `bookings` and cannot be imported.
     */
    private readonly scheduleDispatch: DispatchScheduler,
  ) {}

  async execute(input: CreateBookingInput): Promise<CreatedBooking> {
    const quote = await this.quotes.findById(input.quoteId);

    if (quote === null) {
      throw AppError.notFound('That quote no longer exists. Please get a new price.');
    }
    if (quote.customerId !== input.customerId) {
      // Someone else's quote. 404 rather than 403: whether a given id exists is not information
      // this caller is entitled to.
      throw AppError.notFound('That quote no longer exists. Please get a new price.');
    }

    // Already booked — return that booking rather than making a second.
    if (quote.consumedBy !== null) {
      const existing = await this.repo.findById(quote.consumedBy);
      if (existing !== null) return settled(existing);
    }

    /*
     * A customer carrying unpaid dues MUST pay by UPI.
     *
     * Cash has no payment leg to settle them on, so allowing it would let a cancellation fee
     * outlive every future trip — and the cheapest way to never pay one would be to always book
     * cash. Refused rather than silently upgraded to UPI, because the customer chose a mode and
     * deserves to be told why they cannot have it.
     */
    const duesPaise = await this.charges.outstandingDues(input.customerId);
    if (duesPaise > 0 && input.paymentMode === 'CASH') {
      throw AppError.badRequest(
        'You have an unpaid cancellation fee. Please pay for this trip by UPI to clear it.',
        { outstanding_dues_paise: duesPaise },
      );
    }

    const now = new Date();
    const snapshot = await this.settings.snapshot();

    const isScheduled = isScheduledBooking(quote.scheduledAt, now);
    const leadMinutes = snapshot['dispatch.scheduled_lead_minutes'];

    /*
     * A scheduled booking waits until T−lead before looking for anyone; an immediate one starts
     * now. `Math.max` guards the case where T−lead is already in the past, which happens whenever
     * a booking is made between the lead time and the scheduled hour.
     */
    const dispatchAt = isScheduled
      ? new Date(Math.max(now.getTime(), quote.scheduledAt.getTime() - leadMinutes * 60_000))
      : now;

    const fareSnapshot: FareSnapshot = {
      version: 1,
      serviceType: quote.serviceType,
      computedAt: quote.createdAt,
      source: quote.source,
      included: { minutes: quote.includedMinutes },
      fare: quote.fare,
    };

    const booking = await this.repo.create({
      reference: generateReference(),
      customerId: input.customerId,
      quoteId: quote.id,
      serviceType: quote.serviceType,
      pickup: quote.pickup,
      pickupAddress: input.pickupAddress,
      drop: quote.drop,
      dropAddress: input.dropAddress,
      direction: quote.direction,
      distanceKm: quote.distanceKm,
      fareSnapshot,
      paymentMode: input.paymentMode,
      isScheduled,
      scheduledAt: quote.scheduledAt,
      dispatchAt,
      startOtp: generateOtp(),
    });

    // ── Claim the price ─────────────────────────────────────────────────────────────────────
    const claim = await this.quotes.consume(quote.id, booking.id);

    if (!claim.claimed) {
      if (claim.reason === 'ALREADY_CONSUMED') {
        const winner = await this.repo.findById(claim.bookingId);
        if (winner !== null) return settled(winner);
      }

      /*
       * On expiry the app should re-quote and show a price diff — "₹1,050 became ₹1,100" — rather
       * than an error, so this is a distinct code it can act on. Most of the time nothing has
       * changed and it can proceed silently.
       */
      throw new AppError({
        statusCode: 409,
        code: 'QUOTE_EXPIRED',
        message: 'That price has expired. Here is an up-to-date one.',
        isExpected: true,
      });
    }

    /*
     * ── CASH: no gateway, no payment row, and no webhook is coming ────────────────────────────
     *
     * This is the one path to CONFIRMED that is not a signature-verified capture, and it is only
     * safe because nothing has been promised in exchange: the money is collected at the end of the
     * trip by the driver, who becomes liable for it (`CASH_COLLECTED` at completion).
     *
     * Dispatch is enqueued HERE because the webhook — which does it for a prepaid booking — will
     * never fire for this one.
     */
    if (input.paymentMode === 'CASH') {
      const confirmed = await this.repo.transition({
        bookingId: booking.id,
        from: 'PENDING_PAYMENT',
        to: 'CONFIRMED',
        actor: { type: 'SYSTEM', id: null },
        metadata: { via: 'cash' },
      });

      const result = confirmed ?? booking;

      try {
        await this.scheduleDispatch(result);
      } catch (error) {
        logger.error(
          { err: error, bookingId: booking.id },
          'could not enqueue dispatch for a cash booking — the sweeper will pick this up',
        );
      }

      logger.info(
        { bookingId: booking.id, reference: booking.reference },
        'cash booking confirmed without a payment',
      );

      return settled(result);
    }

    // ── UPI: collect before anyone is dispatched ────────────────────────────────────────────
    const amountPaise = quote.fare.totalPaise + duesPaise;

    const { payment, clientToken, publicKey } = await this.payments.charge({
      bookingId: booking.id,
      customerId: input.customerId,
      kind: 'BOOKING',
      amountPaise,
      reference: booking.reference,
      idempotencyKey: input.idempotencyKey,
    });

    await this.repo.attachPayment(booking.id, payment.id);

    logger.info(
      { bookingId: booking.id, reference: booking.reference, paymentId: payment.id, duesPaise },
      'booking created, awaiting payment',
    );

    return {
      booking: { ...booking, paymentId: payment.id },
      clientToken,
      publicKey,
      amountPaise,
    };
  }
}

/** A booking with nothing left to pay — cash, or a retry whose charge already went through. */
function settled(booking: Booking): CreatedBooking {
  return { booking, clientToken: null, publicKey: null, amountPaise: null };
}

/**
 * A four-digit code, from `randomInt` rather than `Math.random`.
 *
 * It is not a credential — it proves the customer is standing next to the driver — but it is the
 * one thing stopping a driver marking a trip started while still driving over, and every minute
 * of that would be billed from `startedAt`. A predictable sequence would let a driver guess it
 * and skip the check entirely.
 */
function generateOtp(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}
