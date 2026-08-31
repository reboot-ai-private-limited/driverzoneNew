import { randomInt } from 'node:crypto';
import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { PaymentsContract } from '../../../payments/payments.public.js';
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
  /** One tap, one key. Passed to the gateway so a retried request charges once. */
  idempotencyKey: string;
}

export interface CreatedBooking {
  booking: Booking;
  /** For the payment SDK. Null when the charge already settled — an auto-captured retry. */
  clientToken: string | null;
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
      if (existing !== null) return { booking: existing, clientToken: null };
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
        if (winner !== null) return { booking: winner, clientToken: null };
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

    // ── Collect ─────────────────────────────────────────────────────────────────────────────
    const { payment, clientToken } = await this.payments.charge({
      bookingId: booking.id,
      customerId: input.customerId,
      kind: 'BOOKING',
      amountPaise: quote.fare.totalPaise,
      reference: booking.reference,
      idempotencyKey: input.idempotencyKey,
    });

    await this.repo.attachPayment(booking.id, payment.id);

    logger.info(
      { bookingId: booking.id, reference: booking.reference, paymentId: payment.id },
      'booking created, awaiting payment',
    );

    return { booking: { ...booking, paymentId: payment.id }, clientToken };
  }
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
