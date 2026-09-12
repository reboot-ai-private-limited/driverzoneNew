import type { Request, RequestHandler } from 'express';
import type { BookingStatus } from '@driverzone/contracts';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { toMoney } from '../../../shared/money/format.js';
import type { BookingRepositoryPort } from '../domain/bookingRepository.port.js';
import type { ChargeRepositoryPort } from '../domain/chargeRepository.port.js';
import type { WalletReadContract } from '../../wallet/wallet.public.js';
import type {
  AccountDirectoryContract,
  CustomerContactContract,
  DriverCard,
  DriverCardContract,
} from '../../identity/identity.public.js';
import { BookingNotFoundError } from '../domain/booking.errors.js';
import type { BookingExtension } from '../domain/bookingExtension.entity.js';
import type { ExtensionRepositoryPort } from '../domain/extensionRepository.port.js';
import type { CreateBookingUseCase } from '../application/useCases/createBooking.usecase.js';
import type {
  RequestBookingExtensionUseCase,
  RespondToExtensionUseCase,
} from '../application/useCases/extendBooking.usecase.js';
import type {
  CancelBookingByAdminUseCase,
  CancelBookingByCustomerUseCase,
  CancelBookingByDriverUseCase,
} from '../application/useCases/cancelBooking.usecase.js';
import type { DriverArrivedUseCase } from '../application/useCases/driverArrived.usecase.js';
import type { StartTripUseCase } from '../application/useCases/startTrip.usecase.js';
import type { CompleteTripUseCase } from '../application/useCases/completeTrip.usecase.js';
import type {
  DriverEnRouteUseCase,
  ForceArriveUseCase,
  ReportPickupPinUseCase,
} from '../application/useCases/driverProgress.usecase.js';
import type { SelectPaymentMethodUseCase } from '../application/useCases/selectPaymentMethod.usecase.js';
import type {
  VerifyExtrasPaymentUseCase,
  VerifyPaymentUseCase,
} from '../application/useCases/verifyPayment.usecase.js';
import type { PayTripExtrasUseCase } from '../application/useCases/payExtras.usecase.js';
import type {
  CollectExtrasInCashUseCase,
  DriverSwitchToCashUseCase,
} from '../application/useCases/driverSwitchToCash.usecase.js';
import { toBookingDto, toBookingEventDto } from './bookings.mapper.js';
import {
  adminBookingListQuerySchema,
  bookingIdParamSchema,
  cancelBookingSchema,
  completeTripSchema,
  createBookingSchema,
  driverArrivedSchema,
  forceArriveSchema,
  reportPinSchema,
  selectPaymentMethodSchema,
  startTripSchema,
  verifyExtrasPaymentSchema,
  verifyPaymentSchema,
} from './bookings.validation.js';

/**
 * How far back the history endpoint reaches.
 *
 * A cap rather than pagination, because the screen reading this filters and searches CLIENT-side
 * over whatever it is given — paging under a client-side filter would silently hide matches on
 * page two. When history outgrows one response, the filters move to the server in the same change
 * that adds the cursor, not before.
 */
const HISTORY_LIMIT = 100;

function principalOf(req: Request): string {
  const sub = req.principal?.sub;
  if (sub === undefined) {
    throw AppError.internal('INTERNAL', {
      reason: 'requireAuth ran but left no principal on the request',
    });
  }
  return sub;
}

/**
 * The idempotency key that makes a double-tapped Confirm charge once.
 *
 * REQUIRED, not optional. Generating one server-side when the header is missing would defeat the
 * point entirely — the whole mechanism depends on the key being stable across the client's
 * retries, and a per-request key is no key at all.
 */
function idempotencyKeyOf(req: Request): string {
  const key = req.get('idempotency-key');
  if (key === undefined || key.trim() === '') {
    throw AppError.badRequest('An Idempotency-Key header is required on this request.');
  }
  return key.trim();
}

export function makeCreateBookingController(useCase: CreateBookingUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const body = createBookingSchema.parse(req.body);

    const result = await useCase.execute({
      customerId: principalOf(req),
      quoteId: body.quoteId,
      pickupAddress: body.pickupAddress,
      dropAddress: body.dropAddress,
      paymentMode: body.paymentMode,
      carCategory: body.carCategory,
      vehicleType: body.vehicleType,
      preferFavouriteDrivers: body.preferFavouriteDrivers,
      idempotencyKey: idempotencyKeyOf(req),
    });

    sendSuccess(
      req,
      res,
      {
        booking: toBookingDto({ booking: result.booking, adjustments: [] }),
        client_token: result.clientToken,
        public_key: result.publicKey,
        amount: result.amountPaise === null ? null : toMoney(result.amountPaise),
      },
      'Booking confirmed',
      201,
    );
  });
}

export function makeSelectPaymentMethodController(
  useCase: SelectPaymentMethodUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = selectPaymentMethodSchema.parse(req.body);

    const result = await useCase.execute({
      bookingId: id,
      customerId: principalOf(req),
      paymentMode: body.payment_mode,
      idempotencyKey: idempotencyKeyOf(req),
    });

    sendSuccess(
      req,
      res,
      {
        booking: toBookingDto({ booking: result.booking, adjustments: [] }),
        client_token: result.clientToken,
        public_key: result.publicKey,
        amount: result.amountPaise === null ? null : toMoney(result.amountPaise),
      },
      result.booking.paymentMode === 'CASH'
        ? 'Cash payment selected — pay the driver at the end of your trip'
        : 'Online payment selected — proceed to checkout',
      200,
    );
  });
}

export function makeVerifyPaymentController(useCase: VerifyPaymentUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = verifyPaymentSchema.parse(req.body);

    const booking = await useCase.execute({
      bookingId: id,
      customerId: principalOf(req),
      providerPaymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature,
    });

    sendSuccess(
      req,
      res,
      { booking: toBookingDto({ booking, adjustments: [] }) },
      'Payment confirmed',
    );
  });
}

/**
 * `POST /customer/bookings/:id/extras/pay` — the checkout for an accepted day extension.
 *
 * NO BOOKING IN THE RESPONSE, unlike its sibling above. Nothing about the booking has changed: an
 * order has been opened and not a rupee has moved, so returning a booking here would hand the app
 * a DTO whose `payable.outstanding` still says the money is owed — which it is — one line above a
 * success message. The app already holds the booking and refetches it after the capture.
 */
export function makePayTripExtrasController(useCase: PayTripExtrasUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);

    const order = await useCase.execute({ bookingId: id, customerId: principalOf(req) });

    sendSuccess(
      req,
      res,
      {
        payment_id: order.paymentId,
        client_token: order.clientToken,
        public_key: order.publicKey,
        amount: toMoney(order.amountPaise),
      },
      'Proceed to checkout for your extra day',
      200,
    );
  });
}

export function makeVerifyExtrasPaymentController(
  useCase: VerifyExtrasPaymentUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = verifyExtrasPaymentSchema.parse(req.body);

    const booking = await useCase.execute({
      bookingId: id,
      customerId: principalOf(req),
      paymentId: body.payment_id,
      providerPaymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature,
    });

    sendSuccess(
      req,
      res,
      { booking: toBookingDto({ booking, adjustments: [] }) },
      'Extra day paid',
    );
  });
}

export function makeDriverSwitchToCashController(
  useCase: DriverSwitchToCashUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);

    const booking = await useCase.execute({
      bookingId: id,
      driverId: principalOf(req),
    });

    sendSuccess(
      req,
      res,
      { booking: toBookingDto({ booking, adjustments: [] }) },
      'Switched to cash — collect the fare from the customer',
    );
  });
}

/**
 * `POST /driver/bookings/:id/extras/cash` — the extra day was handed over in cash.
 *
 * The narrow sibling of the one above, for a trip whose FARE was already paid online and which
 * therefore cannot be switched to cash wholesale. See `CollectExtrasInCashUseCase`.
 */
export function makeCollectExtrasInCashController(
  useCase: CollectExtrasInCashUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);

    const booking = await useCase.execute({ bookingId: id, driverId: principalOf(req) });

    sendSuccess(
      req,
      res,
      { booking: toBookingDto({ booking, adjustments: [] }) },
      'Recorded — you collected the extra day in cash',
    );
  });
}

/**
 * One driver card, or null — the customer-facing lookup, used by every read below.
 *
 * A booking with no driver skips the query entirely rather than asking for an empty set, because
 * most reads of a searching booking would otherwise pay for a lookup that can only return nothing.
 */
async function cardFor(
  directory: DriverCardContract,
  driverId: string | null,
): Promise<DriverCard | null> {
  if (driverId === null) return null;
  const cards = await directory.driverCardsByIds([driverId]);
  return cards.get(driverId) ?? null;
}

/** The customer's own booking, which is the only view that carries the trip code. */
export function makeGetCustomerBookingController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
  directory: DriverCardContract,
  extensions: ExtensionRepositoryPort,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const customerId = principalOf(req);

    const booking = await repo.findById(id);
    if (booking === null || booking.customerId !== customerId) throw new BookingNotFoundError(id);

    const [adjustments, startOtp, driverCard, extensionRows] = await Promise.all([
      charges.listAdjustments(booking.id),
      // Shown to the customer so they can read it out — and only ever from here.
      repo.readStartOtp(booking.id),
      cardFor(directory, booking.driverId),
      // Resolved on the single-booking read, not the list: this is the screen with the Extend
      // button on it, and a history list would pay a query per row to render nothing.
      extensions.listForBooking(booking.id),
    ]);

    sendSuccess(
      req,
      res,
      toBookingDto({ booking, adjustments, startOtp, driverCard, extensions: extensionRows }),
      'Booking',
    );
  });
}

/**
 * `GET /customer/bookings` — the caller's own ride history, newest first.
 *
 * SCOPED BY THE TOKEN, never by a query parameter. There is no `?customerId=`, so there is no
 * shape of this request that reads somebody else's history.
 *
 * NO TRIP CODES. `startOtp` is deliberately not passed to the mapper, so every row comes back
 * with `start_otp: null` — the single-booking read is the one place that code is handed out, and
 * a list would put every code a customer has ever had into one response.
 *
 * Adjustments are fetched per booking rather than in one query, which is `HISTORY_LIMIT` round
 * trips. That is fine at a customer's own history size and is the honest thing to fix with a
 * batched `listAdjustmentsFor(bookingIds)` on the port the day a customer has hundreds.
 */
export function makeListCustomerBookingsController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
  directory: DriverCardContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const bookings = await repo.listForCustomer(principalOf(req), HISTORY_LIMIT);

    /*
     * ONE LOOKUP FOR THE WHOLE PAGE, deduped — a customer with forty rides from the same regular
     * driver is one row in this query, not forty. The phone number is still gated per booking by
     * the mapper, so a history full of finished trips carries none of them.
     */
    const driverIds = bookings
      .map((booking) => booking.driverId)
      .filter((id): id is string => id !== null);
    const cards = await directory.driverCardsByIds(driverIds);

    const dtos = await Promise.all(
      bookings.map(async (booking) =>
        toBookingDto({
          booking,
          adjustments: await charges.listAdjustments(booking.id),
          driverCard: booking.driverId === null ? null : (cards.get(booking.driverId) ?? null),
        }),
      ),
    );

    sendSuccess(req, res, { bookings: dtos }, 'Your rides');
  });
}

/**
 * The driver's view of the same booking. No trip code, deliberately.
 *
 * CARRIES THE CUSTOMER CARD — name, and the number to call while the trip is live. The customer's
 * own read of this booking gets neither; this is the mirror of the driver card a customer sees.
 * `customerContactsByIds` resolves it in one lookup, and `toBookingDto` gates the phone on the
 * trip still being live (`PHONE_VISIBLE_STATUSES`).
 */
export function makeGetDriverBookingController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
  directory: AccountDirectoryContract & CustomerContactContract,
  extensions: ExtensionRepositoryPort,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const driverId = principalOf(req);

    const booking = await repo.findById(id);
    if (booking === null || booking.driverId !== driverId) throw new BookingNotFoundError(id);

    const [adjustments, contacts, extensionRows] = await Promise.all([
      charges.listAdjustments(booking.id),
      directory.customerContactsByIds([booking.customerId]),
      // THE READ THE DRIVER'S TRIP SCREEN ACTUALLY MAKES. `/current` is the recovery path after
      // the app is killed; this is the one the screen polls, so the confirm card lives or dies
      // on it being here.
      extensions.listForBooking(booking.id),
    ]);

    sendSuccess(
      req,
      res,
      toBookingDto({
        booking,
        adjustments,
        customerCard: contacts.get(booking.customerId) ?? null,
        extensions: extensionRows,
        revealDriverEarnings: true,
      }),
      'Booking',
    );
  });
}

/**
 * `GET /driver/bookings` — this driver's own trip history, newest first.
 *
 * SCOPED BY THE TOKEN, like the customer's list: no `?driverId=`, so no shape of this request
 * reads somebody else's trips.
 *
 * NAMES IN ONE QUERY, not one per row. `namesByIds` exists precisely for this — the "batch, don't
 * invite N+1" rule in docs/engineering/module-anatomy.md — and a history of `HISTORY_LIMIT` rows
 * would otherwise be a hundred lookups to render a hundred names.
 *
 * Adjustments are still fetched per booking, matching the customer list, and carry the same note:
 * the honest fix is a batched `listAdjustmentsFor(bookingIds)` on the port the day this hurts.
 */
export function makeListDriverTripsController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
  directory: AccountDirectoryContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const bookings = await repo.listForDriver(principalOf(req), HISTORY_LIMIT);

    const names = await directory.namesByIds(
      'CUSTOMER',
      // Deduped: a repeat customer must not be looked up once per trip they took.
      [...new Set(bookings.map((booking) => booking.customerId))],
    );

    const dtos = await Promise.all(
      bookings.map(async (booking) =>
        toBookingDto({
          booking,
          adjustments: await charges.listAdjustments(booking.id),
          customerName: names.get(booking.customerId) ?? null,
        }),
      ),
    );

    sendSuccess(req, res, { bookings: dtos }, 'Your trips');
  });
}

/**
 * `GET /customer/bookings/current` — the booking happening to this customer now, or `null`.
 *
 * CARRIES THE START OTP, like the single-booking read and unlike the history list. That is the
 * point of the endpoint rather than a detail of it: the code lives on the live trip screen only,
 * so a customer whose app was killed at the pickup had no route back to the four digits their
 * driver is standing there waiting for.
 *
 * Scoped by the token, and `null` rather than 404 when nothing is live — the app asks on launch.
 */
export function makeGetCurrentCustomerBookingController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
  directory: DriverCardContract,
  extensions: ExtensionRepositoryPort,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const booking = await repo.findActiveForCustomer(principalOf(req));

    if (booking === null) {
      sendSuccess(req, res, { booking: null }, 'No booking in progress');
      return;
    }

    const [adjustments, startOtp, driverCard, extensionRows] = await Promise.all([
      charges.listAdjustments(booking.id),
      repo.readStartOtp(booking.id),
      cardFor(directory, booking.driverId),
      extensions.listForBooking(booking.id),
    ]);

    sendSuccess(
      req,
      res,
      {
        booking: toBookingDto({
          booking,
          adjustments,
          startOtp,
          driverCard,
          extensions: extensionRows,
        }),
      },
      'Booking in progress',
    );
  });
}

/**
 * `GET /driver/bookings/current` — the trip this driver is in the middle of, or `null`.
 *
 * THE TRIP EQUIVALENT OF `GET /driver/offers`, and it exists for the same reason: the app
 * is killed mid-job by an OEM battery manager, and the booking id it needs to get back only ever
 * lived in navigation state. Without this the driver reopens to the duty screen with a customer
 * waiting and no route to arrive, start or complete.
 *
 * SCOPED BY THE TOKEN. There is no id in the path, so there is no shape of this request that
 * reads somebody else's trip.
 *
 * `null` rather than a 404 when nothing is live — "you are not on a trip" is a normal answer to
 * this question, and the app asks it on every launch.
 */
export function makeGetCurrentDriverTripController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
  directory: CustomerContactContract,
  extensions: ExtensionRepositoryPort,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const booking = await repo.findActiveForDriver(principalOf(req));

    if (booking === null) {
      sendSuccess(req, res, { booking: null }, 'No trip in progress');
      return;
    }

    const [adjustments, contacts, extensionRows] = await Promise.all([
      charges.listAdjustments(booking.id),
      directory.customerContactsByIds([booking.customerId]),
      // The driver's half of the same screen: this is where they answer a pending request.
      extensions.listForBooking(booking.id),
    ]);

    sendSuccess(
      req,
      res,
      {
        booking: toBookingDto({
          booking,
          adjustments,
          customerCard: contacts.get(booking.customerId) ?? null,
          extensions: extensionRows,
          // This is the driver's own trip: they are the one being asked to commit a day.
          revealDriverEarnings: true,
        }),
      },
      'Trip in progress',
    );
  });
}

/**
 * `POST /admin/bookings/:id/cancel`.
 *
 * The same request shape as the customer's and the driver's — a reason and nothing else — but the
 * response's `fee` is always zero. It is sent anyway rather than omitted, so the panel renders one
 * cancellation result shape whoever cancelled.
 */
export function makeCancelByAdminController(useCase: CancelBookingByAdminUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = cancelBookingSchema.parse(req.body);

    const result = await useCase.execute({
      bookingId: id,
      actorId: principalOf(req),
      reason: body.reason,
    });

    sendSuccess(
      req,
      res,
      {
        booking: toBookingDto({ booking: result.booking, adjustments: [] }),
        fee: toMoney(result.feePaise),
        refunded: toMoney(result.refundedPaise),
      },
      'Booking cancelled — nobody was charged',
    );
  });
}

export function makeCancelByCustomerController(
  useCase: CancelBookingByCustomerUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = cancelBookingSchema.parse(req.body);

    const result = await useCase.execute({
      bookingId: id,
      actorId: principalOf(req),
      reason: body.reason,
    });

    sendSuccess(
      req,
      res,
      {
        booking: toBookingDto({ booking: result.booking, adjustments: [] }),
        fee: toMoney(result.feePaise),
        refunded: toMoney(result.refundedPaise),
      },
      'Booking cancelled',
    );
  });
}

export function makeCancelByDriverController(useCase: CancelBookingByDriverUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = cancelBookingSchema.parse(req.body);

    const result = await useCase.execute({
      bookingId: id,
      actorId: principalOf(req),
      reason: body.reason,
    });

    sendSuccess(
      req,
      res,
      {
        booking: toBookingDto({ booking: result.booking, adjustments: [] }),
        fee: toMoney(result.feePaise),
        refunded: toMoney(0),
      },
      'Booking cancelled',
    );
  });
}

export function makeEnRouteController(useCase: DriverEnRouteUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const booking = await useCase.execute(id, principalOf(req));
    sendSuccess(req, res, toBookingDto({ booking, adjustments: [] }), 'On the way');
  });
}

export function makeArrivedController(useCase: DriverArrivedUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = driverArrivedSchema.parse(req.body);

    const booking = await useCase.execute({
      bookingId: id,
      driverId: principalOf(req),
      location: { lat: body.location.lat, lng: body.location.lng },
      fixTakenAt: body.location.takenAt,
    });

    sendSuccess(req, res, toBookingDto({ booking, adjustments: [] }), 'Arrived at pickup');
  });
}

export function makeStartTripController(useCase: StartTripUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = startTripSchema.parse(req.body);

    const booking = await useCase.execute({
      bookingId: id,
      driverId: principalOf(req),
      otp: body.otp,
      ...(body.location === undefined ? {} : { location: body.location }),
    });

    sendSuccess(req, res, toBookingDto({ booking, adjustments: [] }), 'Trip started');
  });
}

export function makeCompleteTripController(
  useCase: CompleteTripUseCase,
  charges: ChargeRepositoryPort,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = completeTripSchema.parse(req.body);

    const result = await useCase.execute({
      bookingId: id,
      driverId: principalOf(req),
      ...(body.actualDistanceM === undefined ? {} : { actualDistanceM: body.actualDistanceM }),
      ...(body.cashCollectedPaise === undefined
        ? {}
        : { cashCollectedPaise: body.cashCollectedPaise }),
      idempotencyKey: idempotencyKeyOf(req),
    });

    const adjustments = await charges.listAdjustments(id);

    sendSuccess(
      req,
      res,
      {
        booking: toBookingDto({ booking: result.booking, adjustments }),
        waiting_charge: toMoney(result.waitingChargePaise),
        total: toMoney(result.totalPaise),
      },
      'Trip complete',
    );
  });
}

/**
 * `GET /customer/bookings/dues`.
 *
 * Registered BEFORE `/:id`, or `dues` is read as a booking id and answers 404.
 */
/**
 * `GET /customer/bookings/dues` — what this customer owes, and therefore how they may pay.
 *
 * READS THE WALLET, not the charge rows. The wallet is the single source of an outstanding
 * balance since it took over from `outstandingDues`, and it answers a question the charges cannot:
 * a customer holding granted credit owes nothing even with an unsettled fee, because the two net
 * against each other.
 */
export function makeGetDuesController(wallet: WalletReadContract): RequestHandler {
  return asyncHandler(async (req, res) => {
    const balancePaise = await wallet.balance(principalOf(req));
    const outstandingPaise = Math.max(0, -balancePaise);

    sendSuccess(
      req,
      res,
      {
        outstanding: toMoney(outstandingPaise),
        /** Credit, where there is any — the same figure the fare sheet takes off the total. */
        credit: toMoney(Math.max(0, balancePaise)),
        // Cash cannot clear a debt, so it is withheld until there is none.
        payment_modes: outstandingPaise > 0 ? ['UPI'] : ['UPI', 'CASH'],
      },
      outstandingPaise > 0
        ? 'You have an unpaid cancellation fee, which will be added to your next trip.'
        : 'Nothing outstanding',
    );
  });
}

export function makeReportPinController(useCase: ReportPickupPinUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = reportPinSchema.parse(req.body);

    const result = await useCase.execute({
      bookingId: id,
      driverId: principalOf(req),
      location: body.location,
      ...(body.note === undefined ? {} : { note: body.note }),
    });

    sendSuccess(
      req,
      res,
      { distance_metres: result.distanceMetres },
      'Reported. Our team will sort this out — please stay where you are.',
    );
  });
}

export function makeForceArriveController(useCase: ForceArriveUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = forceArriveSchema.parse(req.body);

    const booking = await useCase.execute(id, principalOf(req), body.reason);
    sendSuccess(req, res, toBookingDto({ booking, adjustments: [] }), 'Driver marked as arrived');
  });
}

/**
 * A `YYYY-MM-DD` day, read in the timezone the admin lives in.
 *
 * IST, NOT UTC — the same boundary `ledger.controller.ts` documents and for the same reason:
 * `new Date('2026-09-04')` is midnight UTC, which is 05:30 on the 4th in India, so an admin
 * filtering "the 4th" would lose every booking from before breakfast and gain the small hours of
 * the 5th. Duplicated rather than shared because a `shared/` date module that two interface
 * layers reach into is the kind of coupling this codebase's module rules exist to prevent — the
 * day this becomes a third copy is the day it earns a home.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function startOfDay(isoDate: string): Date {
  return new Date(new Date(`${isoDate}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}

/**
 * The instant the NEXT day begins, so `to` can be an EXCLUSIVE bound while meaning an inclusive
 * day. "To 18 May" has to include a booking at 23:50 on the 18th; comparing `<=` against the
 * start of the 18th would drop everything but the first instant of it.
 */
function startOfNextDay(isoDate: string): Date {
  return new Date(startOfDay(isoDate).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * How many accounts a name-or-number search may resolve to before the query stops widening.
 *
 * A one-letter search matches most of the customer table, and every id it returns is spliced into
 * an `$in`. Two hundred is generous for a search box — past that the admin is not looking for
 * somebody, they are browsing, and the right answer is to narrow the term.
 */
const SEARCH_ACCOUNT_LIMIT = 200;

/**
 * `GET /admin/bookings` — the booking management table.
 *
 * THE ONLY BOOKING LIST THAT PAGES, because it is the only one that is not a single person's
 * history. See `AdminBookingListDto` for why it still returns `BookingDto` unchanged.
 *
 * A NAME OR MOBILE SEARCH COSTS TWO EXTRA QUERIES, one per role, and they run in parallel with
 * each other. `identity` turns the term into account ids and this module intersects them with its
 * own rows — the module boundary means there is no join available, and `bookings` has no business
 * reading the accounts collection. When the term is only a reference, both are still issued and
 * return nothing; the alternative is guessing from the shape of the string which kind of search
 * an admin meant, and "9001" is a plausible reference and a plausible phone number at once.
 *
 * Names are resolved for the PAGE, one batched lookup per role, exactly as the driver's trip
 * history does it. Phones are never resolved: `toBookingDto` would gate them on the trip being
 * live anyway, and an admin table is not a kerb.
 */
export function makeListAdminBookingsController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
  directory: AccountDirectoryContract & CustomerContactContract & DriverCardContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const query = adminBookingListQuerySchema.parse(req.query);

    /*
     * Both roles, in parallel, and only when there is something to search for. `undefined` (no
     * term) and `[]` (a term that matched nobody) are different answers and the repository treats
     * them differently — see `AdminBookingFilter.accountIds`.
     */
    const accountIds =
      query.search === undefined || query.search === ''
        ? undefined
        : (
            await Promise.all([
              directory.idsMatching('CUSTOMER', query.search, SEARCH_ACCOUNT_LIMIT),
              directory.idsMatching('DRIVER', query.search, SEARCH_ACCOUNT_LIMIT),
            ])
          ).flat();

    const { bookings, totalItems } = await repo.listForAdmin({
      page: query.page,
      limit: query.limit,
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(accountIds === undefined ? {} : { accountIds }),
      ...(query.status === undefined ? {} : { statuses: query.status as BookingStatus[] }),
      ...(query.from === undefined ? {} : { from: startOfDay(query.from) }),
      ...(query.to === undefined ? {} : { before: startOfNextDay(query.to) }),
    });

    /*
     * CONTACTS, NOT BARE NAMES — one batched lookup per role, deduped so a repeat customer is not
     * fetched once per booking they made. `revealPhones` below is what makes the numbers
     * survive the mapper's live-trip gate; see its note for why an admin is exempt from it.
     */
    const [contacts, cards] = await Promise.all([
      directory.customerContactsByIds([...new Set(bookings.map((b) => b.customerId))]),
      directory.driverCardsByIds([
        ...new Set(bookings.map((b) => b.driverId).filter((id): id is string => id !== null)),
      ]),
    ]);

    const dtos = await Promise.all(
      bookings.map(async (booking) =>
        toBookingDto({
          booking,
          adjustments: await charges.listAdjustments(booking.id),
          revealPhones: true,
          customerCard: contacts.get(booking.customerId) ?? null,
          driverCard: booking.driverId === null ? null : (cards.get(booking.driverId) ?? null),
        }),
      ),
    );

    sendSuccess(
      req,
      res,
      {
        bookings: dtos,
        pagination: {
          page: query.page,
          limit: query.limit,
          total_items: totalItems,
          total_pages: Math.max(1, Math.ceil(totalItems / query.limit)),
        },
      },
      'Bookings listed',
    );
  });
}

/**
 * `GET /admin/bookings/:id` — one booking, in full.
 *
 * Named on the row's own terms rather than either party's: no start OTP (the code exists so the
 * customer can prove themselves to the driver, and an admin reading it defeats that), and names
 * without phone numbers, matching the list.
 */
export function makeGetAdminBookingController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
  directory: CustomerContactContract & DriverCardContract,
  extensions: ExtensionRepositoryPort,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);

    const booking = await repo.findById(id);
    if (booking === null) throw new BookingNotFoundError(id);

    /*
     * THE EXTENSIONS TOO, and only on this read — the same rule the customer's and driver's
     * single-trip reads follow, and for the same reason the list does not: a finished trip cannot
     * be extended, and the list would pay a query per row to say so.
     *
     * Without it an admin looking at a LIVE trip could not see an extra day at all. The
     * `DAY_EXTENSION` adjustment row that carries it on a finished trip is not written until
     * completion, so the one moment support is most likely to be asked — the customer is on the
     * phone and the trip is still running — was the one moment the panel had nothing to show.
     */
    const [contacts, cards, adjustments, extensionRows] = await Promise.all([
      directory.customerContactsByIds([booking.customerId]),
      booking.driverId === null
        ? Promise.resolve(new Map<string, DriverCard>())
        : directory.driverCardsByIds([booking.driverId]),
      charges.listAdjustments(booking.id),
      extensions.listForBooking(booking.id),
    ]);

    sendSuccess(
      req,
      res,
      toBookingDto({
        booking,
        adjustments,
        extensions: extensionRows,
        revealPhones: true,
        customerCard: contacts.get(booking.customerId) ?? null,
        driverCard: booking.driverId === null ? null : (cards.get(booking.driverId) ?? null),
      }),
      'Booking',
    );
  });
}

/**
 * The booking's whole history, admin-only.
 *
 * This is what every dispute is answered from, so it is returned unfiltered and in order —
 * support staff should never have to ask an engineer what happened to a booking.
 */
export function makeListEventsController(repo: BookingRepositoryPort): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);

    const booking = await repo.findById(id);
    if (booking === null) throw new BookingNotFoundError(id);

    const events = await repo.listEvents(id);
    sendSuccess(
      req,
      res,
      { reference: booking.reference, events: events.map(toBookingEventDto) },
      'Booking history',
    );
  });
}

// ─── Day extensions ──────────────────────────────────────────────────────────────────────────

/** One extension, as both apps read it. */
function toExtensionDto(extension: BookingExtension) {
  return {
    id: extension.id,
    status: extension.status,
    amount: toMoney(extension.amountPaise),
    /** What the DRIVER earns from it. Rendered by the driver app; harmless to the customer. */
    driver_amount: toMoney(extension.driverAmountPaise),
    expires_at: extension.expiresAt.toISOString(),
    requested_at: extension.requestedAt.toISOString(),
  };
}

/** `POST /customer/bookings/:id/extend` — asks the driver for one more day. */
export function makeRequestExtensionController(
  useCase: RequestBookingExtensionUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);

    const extension = await useCase.execute({ bookingId: id, customerId: principalOf(req) });

    sendSuccess(
      req,
      res,
      toExtensionDto(extension),
      'Asked your driver for an extra day',
      201,
    );
  });
}

/**
 * `POST /driver/bookings/:id/extension/accept` and `/decline`.
 *
 * ONE FACTORY, BOUND AT THE ROUTE, rather than reading the answer out of the body. A driver's yes
 * and no are two different URLs, so neither can be produced by a malformed request that meant the
 * other — and the route table reads as what it does.
 */
export function makeRespondToExtensionController(
  useCase: RespondToExtensionUseCase,
  accept: boolean,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);

    const extension = await useCase.execute({
      bookingId: id,
      driverId: principalOf(req),
      accept,
    });

    sendSuccess(
      req,
      res,
      toExtensionDto(extension),
      accept
        ? 'Extra day confirmed — it is added to this trip'
        : 'You have declined the extra day',
    );
  });
}
