import { randomInt } from 'node:crypto';
import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type {
  AdminPaymentMode,
  CarCategory,
  DispatchMode,
  PaymentMode,
  VehicleTypePreference,
} from '@driverzone/contracts';
import type { DispatchScheduler } from './confirmBookingPayment.usecase.js';
import type { QuoteConsumptionContract } from '../../../quotes/quotes.public.js';
import type { CustomerBookingProfileContract } from '../../../identity/identity.public.js';
import type { SettingsReadContract } from '../../../settings/settings.public.js';
import type { WalletPublicContract } from '../../../wallet/wallet.public.js';
import {
  generateReference,
  isScheduledBooking,
  type Actor,
  type Booking,
  type BookingRider,
  type FareSnapshot,
} from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';

export interface CreateBookingInput {
  customerId: string;
  quoteId: string;
  pickupAddress: string;
  dropAddress: string;
  paymentMode?: PaymentMode | undefined;
  /**
   * The car the driver is being booked for. Not a pricing input — it never reaches the fare — so
   * it arrives here rather than on the quote, and its only consumer is the eligibility query.
   */
  carCategory: CarCategory;
  vehicleType: VehicleTypePreference;
  /** One of the customer's saved cars. Takes precedence over `plateNumber`. */
  vehicleId?: string | undefined;
  /** A car number typed at booking — saved to the customer's profile as well. */
  plateNumber?: string | undefined;
  /** The passenger, when booking for someone else. Absent means the customer is travelling. */
  rider?: BookingRider | undefined;
  /**
   * Ring this customer's favourites first. Frozen onto the booking, not consulted here — `bookings`
   * sits below `favourites` and below `dispatch`, and neither the list nor the wave is its
   * business. All this module does is record what the customer asked for.
   */
  preferFavouriteDrivers: boolean;
  /** One tap, one key. Passed to the gateway so a retried request charges once. */
  idempotencyKey: string;
  /**
   * `MANUAL` when an admin is booking from the panel: the booking is created and confirmed exactly
   * as the app's would be, but NO DISPATCH IS ENQUEUED — an admin assigns the driver by hand.
   * Omitted means `AUTO`, which is every customer booking.
   */
  dispatchMode?: DispatchMode | undefined;
  /**
   * Who is making the booking, for the event log. Omitted means the customer themselves; an admin
   * booking on their behalf passes `{ type: 'ADMIN', id }`.
   */
  createdBy?: Actor | undefined;
  /**
   * The admin's payment choice, set up front. Omitted — every customer booking — leaves the mode
   * null until the customer picks one after the trip starts.
   *
   * `PREPAID`: the customer already paid the company. The booking starts `PAID`, and the wallet is
   * NOT applied to it — the admin collected a fixed figure offline, so spending the customer's
   * credit or adding their old fee here would make the trip disagree with what they actually paid.
   * An old fee stays on the wallet as dues for a later trip.
   */
  presetPayment?: { mode: AdminPaymentMode; reference: string | null } | undefined;
}

export interface CreatedBooking {
  booking: Booking;
  /** The gateway order id, for checkout. Null at creation; populated when online payment is chosen. */
  clientToken: string | null;
  /** The publishable key checkout needs beside the order. Null at creation. */
  publicKey: string | null;
  /** What is being charged. Null at creation. */
  amountPaise: number | null;
}

/**
 * Turns a quote into a confirmed booking and enqueues dispatch immediately.
 *
 * Payment method selection is deferred until the ride has STARTED. Every booking confirms
 * immediately, spends credit immediately if any, and dispatches a driver without upfront charge.
 */
export class CreateBookingUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly quotes: QuoteConsumptionContract,
    private readonly settings: SettingsReadContract,
    /** The customer's balance: what it takes off this fare, and what it adds to it. */
    private readonly wallet: WalletPublicContract,
    private readonly scheduleDispatch: DispatchScheduler,
    /** The customer's saved cars — read to pick the plate, written when a new one is typed. */
    private readonly vehicles: Pick<
      CustomerBookingProfileContract,
      'vehiclesForBooking' | 'upsertVehicleFromBooking'
    >,
    /** `BOOKING_REQUIRE_PLATE`: refuse a booking that cannot name a car. Off until the app asks. */
    private readonly requirePlate: boolean,
  ) {}

  /**
   * WHICH CAR THIS TRIP IS FOR, as a plate to copy onto the booking.
   *
   *   1. `vehicleId` — one of their saved cars. An id that is not theirs is refused, not ignored:
   *      silently falling back to the default would send the driver to look for the wrong car.
   *   2. `plateNumber` — typed now. Saved to the profile (an upsert keyed on the plate, so a
   *      repeat is not a duplicate) so the next booking can pick it.
   *   3. Neither — their default car, else their first. This is the admin panel's path too.
   *
   * Null when the customer has no car on file and sent none. Whether that is allowed is
   * `requirePlate`'s call, made by the caller.
   */
  private async resolvePlate(input: CreateBookingInput): Promise<string | null> {
    if (input.vehicleId !== undefined) {
      const saved = await this.vehicles.vehiclesForBooking(input.customerId);
      const chosen = saved.find((v) => v.id === input.vehicleId);
      if (chosen === undefined) {
        throw AppError.badRequest('That car is not saved on your profile. Please choose again.');
      }
      return chosen.plateNumber;
    }

    if (input.plateNumber !== undefined) {
      const plate = input.plateNumber.trim().toUpperCase();
      try {
        await this.vehicles.upsertVehicleFromBooking(input.customerId, {
          category: input.carCategory,
          plateNumber: plate,
        });
      } catch (error) {
        // Saving it for next time is a convenience. The booking still records the plate, so a
        // failure here costs the customer one re-type, never the trip.
        logger.warn({ err: error, customerId: input.customerId }, 'could not save a typed plate');
      }
      return plate;
    }

    const saved = await this.vehicles.vehiclesForBooking(input.customerId);
    return (saved.find((v) => v.isDefault) ?? saved[0])?.plateNumber ?? null;
  }

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
     * WHAT THE WALLET DOES TO THIS TRIP'S PRICE — credit off, debt on.
     *
     * PLANNED, NOT SPENT. Nothing is written here: the booking confirms synchronously a few lines
     * down, and credit is spent then, in this same call — there is no upfront payment to wait on
     * any more, so there is no abandoned-checkout case to protect the credit from.
     *
     * `walletDebtPaise` is frozen onto the booking either way; it is only ever actually COLLECTED
     * once the customer picks a payment method after the ride starts — cash cannot carry a debt
     * (`selectPaymentMethod.usecase.ts` refuses it), online collects it on capture
     * (`confirmLatePayment.usecase.ts`).
     *
     * KNOWN RACE, and it is bounded. Two bookings created in the same instant both plan against
     * the same balance and both spend it, taking the wallet negative — which lands as a debt on
     * the next trip rather than as lost money. The fix is a reservation on the balance, which is
     * only worth building when a customer can plausibly have two checkouts open at once.
     */
    /*
     * Enforced on the CUSTOMER's own booking only. An admin booking from the panel has no plate
     * field to fill (yet) and is often for a customer who has never opened the app, so refusing it
     * would only stop ops from doing their job; it uses the saved car when there is one.
     */
    const plateNumber = await this.resolvePlate(input);
    const bookedByCustomer = (input.createdBy?.type ?? 'CUSTOMER') === 'CUSTOMER';
    if (plateNumber === null && this.requirePlate && bookedByCustomer) {
      throw new AppError({
        statusCode: 422,
        code: 'VEHICLE_REQUIRED',
        message: 'Please add your car number to book a driver.',
        isExpected: true,
      });
    }

    const prepaid = input.presetPayment?.mode === 'PREPAID';
    const plan = prepaid
      ? { creditAppliedPaise: 0, debtAddedPaise: 0 }
      : await this.wallet.planFor(input.customerId, quote.fare.totalPaise);

    const dispatchMode: DispatchMode = input.dispatchMode ?? 'AUTO';
    const createdBy: Actor = input.createdBy ?? { type: 'CUSTOMER', id: input.customerId };

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
      carCategory: input.carCategory,
      vehicleType: input.vehicleType,
      plateNumber,
      rider: input.rider === undefined ? null : { name: input.rider.name.trim(), phone: input.rider.phone.trim() },
      preferFavouriteDrivers: input.preferFavouriteDrivers,
      dispatchMode,
      createdBy,
      walletCreditPaise: plan.creditAppliedPaise,
      walletDebtPaise: plan.debtAddedPaise,
      fareSnapshot,
      paymentMode: input.presetPayment?.mode ?? null,
      ...(input.presetPayment === undefined
        ? {}
        : {
            paymentStatus: prepaid ? 'PAID' : 'CASH',
            paymentReference: input.presetPayment.reference,
          }),
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

    const confirmed = await this.repo.transition({
      bookingId: booking.id,
      from: 'PENDING_PAYMENT',
      to: 'CONFIRMED',
      actor: createdBy.type === 'ADMIN' ? createdBy : { type: 'SYSTEM', id: null },
      metadata: {
        via: createdBy.type === 'ADMIN' ? 'admin_booking' : 'booking_creation',
        dispatchMode,
        // The admin's payment choice is on the event log, so "who said this was prepaid" has an
        // answer beyond the booking row itself.
        ...(input.presetPayment === undefined
          ? {}
          : {
              paymentMode: input.presetPayment.mode,
              ...(input.presetPayment.reference === null
                ? {}
                : { paymentReference: input.presetPayment.reference }),
            }),
      },
    });

    const result = confirmed ?? booking;

    /*
     * Booking confirmed synchronously, so wallet credit is spent here — there is no upfront
     * payment webhook to do it later.
     */
    if (plan.creditAppliedPaise > 0) {
      try {
        await this.wallet.append([
          {
            customerId: input.customerId,
            bookingId: booking.id,
            entryType: 'SPENT_ON_RIDE',
            amountPaise: -plan.creditAppliedPaise,
            note: `Used on trip ${booking.reference}`,
          },
        ]);
      } catch (error) {
        logger.error(
          { err: error, bookingId: booking.id },
          'could not spend wallet credit on a confirmed booking',
        );
      }
    }

    /*
     * A MANUAL booking enqueues nothing: an admin hands it to a driver they choose. The sweeper
     * skips it too (`findDueForDispatch`), so it stays CONFIRMED until that happens.
     */
    if (dispatchMode === 'MANUAL') {
      logger.info(
        { bookingId: booking.id, reference: booking.reference, by: createdBy.id },
        'admin booking confirmed — awaiting manual driver assignment',
      );
      return settled(result);
    }

    try {
      await this.scheduleDispatch(result);
    } catch (error) {
      logger.error(
        { err: error, bookingId: booking.id },
        'could not enqueue dispatch for a booking — the sweeper will pick this up',
      );
    }

    logger.info(
      { bookingId: booking.id, reference: booking.reference },
      'booking confirmed and dispatch enqueued',
    );

    return settled(result);
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
