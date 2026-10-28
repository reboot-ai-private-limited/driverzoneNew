import type { Request, RequestHandler, Response } from 'express';
import type {
  BookingStatus,
  DriverTripsSummary,
  ListBookingsResponse,
  ListDriverTripsResponse,
  RideHistorySummary,
} from '@driverzone/contracts';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { logger } from '../../../shared/logging/logger.js';
import { toMoney } from '../../../shared/money/format.js';
import type { BookingRepositoryPort } from '../domain/bookingRepository.port.js';
import type { ChargeRepositoryPort } from '../domain/chargeRepository.port.js';
import type { WalletReadContract } from '../../wallet/wallet.public.js';
import type {
  AccountDirectoryContract,
  CustomerContactContract,
  DriverCard,
  DriverCardContract,
  DriverLocationContract,
} from '../../identity/identity.public.js';
import type { SettingsReadContract } from '../../settings/settings.public.js';
import { liveAssignmentCutoff } from '../domain/booking.entity.js';
import { estimatePickupEtaMinutes } from '../domain/pickupEta.js';
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
  DriverPaymentOverrideUseCase,
  DriverSwitchToCashUseCase,
} from '../application/useCases/driverSwitchToCash.usecase.js';
import type {
  DriverPaymentQrUseCase,
  PaymentQrResult,
} from '../application/useCases/driverPaymentQr.usecase.js';
import { isCaptured, type PaymentsContract } from '../../payments/payments.public.js';
import { toBookingDto, toBookingEventDto, toPaymentQrDto } from './bookings.mapper.js';
import type { Booking } from '../domain/booking.entity.js';
import {
  adminBookingListQuerySchema,
  adminCreateBookingSchema,
  bookingIdParamSchema,
  cancelBookingSchema,
  completeTripSchema,
  createBookingSchema,
  customerHistoryQuerySchema,
  driverArrivedSchema,
  driverHistoryQuerySchema,
  paymentOverrideSchema,
  encodeHistoryCursor,
  forceArriveSchema,
  reportPinSchema,
  selectPaymentMethodSchema,
  startTripSchema,
  verifyExtrasPaymentSchema,
  verifyPaymentSchema,
} from './bookings.validation.js';

/**
 * How far back the UNPAGED history read reaches — the one older app builds make, with no `limit`.
 * They filter client-side over this single response; paged callers never hit it.
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
      vehicleId: body.vehicleId,
      plateNumber: body.plateNumber,
      rider: body.rider,
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

/**
 * `POST /admin/bookings` — an admin books a trip for a customer from the panel.
 *
 * THE SAME USE CASE AS THE APP'S, with two arguments added: `dispatchMode: 'MANUAL'`, so no driver
 * is rung — the admin assigns one — and `createdBy` the admin, so the event log says who actually
 * made it. The quote must belong to the named customer; `CreateBookingUseCase` already refuses
 * anyone else's, which is what stops an admin booking customer A onto customer B's price.
 *
 * The customer is checked to exist first, because this is the one create path where the customer
 * id did not come from that customer's own signed token.
 *
 * The response CARRIES `start_otp` — the admin has to be able to pass it on.
 */
export function makeAdminCreateBookingController(
  useCase: CreateBookingUseCase,
  repo: BookingRepositoryPort,
  directory: CustomerContactContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const body = adminCreateBookingSchema.parse(req.body);

    const contacts = await directory.customerContactsByIds([body.customer_id]);
    const customer = contacts.get(body.customer_id);
    if (customer === undefined) throw AppError.notFound('That customer does not exist.');

    const result = await useCase.execute({
      customerId: body.customer_id,
      quoteId: body.quote_id,
      pickupAddress: body.pickup_address,
      dropAddress: body.drop_address,
      carCategory: body.car_category,
      vehicleType: body.vehicle_type,
      rider: body.rider,
      preferFavouriteDrivers: false,
      idempotencyKey: idempotencyKeyOf(req),
      dispatchMode: 'MANUAL',
      createdBy: { type: 'ADMIN', id: principalOf(req) },
      presetPayment: {
        mode: body.payment_mode,
        // A reference only means something on a prepaid booking; on cash it is dropped, not kept.
        reference:
          body.payment_mode === 'PREPAID' && body.payment_reference !== undefined && body.payment_reference !== ''
            ? body.payment_reference
            : null,
      },
    });

    const startOtp = await repo.readStartOtp(result.booking.id);

    sendSuccess(
      req,
      res,
      {
        booking: toBookingDto({
          booking: result.booking,
          adjustments: [],
          startOtp,
          revealPhones: true,
          customerCard: customer,
        }),
      },
      'Booking created — assign a driver',
      201,
    );
  });
}

/**
 * `POST /admin/bookings/:id/auto-dispatch` — hand a MANUAL booking back to automatic dispatch.
 *
 * For when ops booked a trip intending to pick the driver and then would rather the system find
 * one. Only a driverless, waiting booking can be flipped; the swap is conditional on exactly that,
 * so it cannot race an assignment made a second earlier.
 */
export function makeEnableAutoDispatchController(
  repo: BookingRepositoryPort,
  settings: SettingsReadContract,
  scheduleDispatch: (booking: Booking) => Promise<void>,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);

    const booking = await repo.findById(id);
    if (booking === null) throw new BookingNotFoundError(id);
    if (booking.dispatchMode !== 'MANUAL') {
      throw AppError.conflict('This booking is already dispatched automatically.');
    }

    // The same rule `createBooking` uses: a scheduled trip starts looking at T−lead, never earlier
    // than now.
    const snapshot = await settings.snapshot();
    const leadMs = snapshot['dispatch.scheduled_lead_minutes'] * 60_000;
    const now = Date.now();
    const dispatchAt = booking.isScheduled
      ? new Date(Math.max(now, booking.scheduledAt.getTime() - leadMs))
      : new Date(now);

    const flipped = await repo.enableAutoDispatch(id, dispatchAt);
    if (flipped === null) {
      throw AppError.conflict(
        'This booking moved on while you were changing it — it may already have a driver. Reload and check.',
      );
    }

    try {
      await scheduleDispatch(flipped);
    } catch (error) {
      // The sweeper re-enqueues anything due and AUTO, so this heals on its own within a minute.
      logger.error({ err: error, bookingId: id }, 'could not enqueue dispatch after enabling it');
    }

    sendSuccess(
      req,
      res,
      { booking: toBookingDto({ booking: flipped, adjustments: [] }) },
      'Automatic dispatch enabled',
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
 * `POST /driver/bookings/:id/payment-override` — the driver takes the payment in cash because the
 * customer cannot finish it in their app. See `DriverPaymentOverrideUseCase`.
 */
/**
 * `POST` and `GET /driver/bookings/:id/payment-qr` — the QR the driver shows to collect the whole
 * trip, and where it stands. See `DriverPaymentQrUseCase`.
 *
 * THE BOOKING IN THE RESPONSE IS BUILT EXACTLY LIKE `GET /driver/bookings/:id`, customer card and
 * all. The driver's screen polls this every couple of seconds while the QR is up and adopts the
 * booking it returns; a leaner copy would wipe the customer and passenger cards off the trip
 * screen on every poll.
 */
export function makeDriverPaymentQrControllers(
  useCase: DriverPaymentQrUseCase,
  charges: ChargeRepositoryPort,
  directory: CustomerContactContract,
  extensions: ExtensionRepositoryPort,
): { create: RequestHandler; status: RequestHandler } {
  const respond = async (req: Request, res: Response, result: PaymentQrResult, message: string, code = 200) => {
    const { booking } = result;
    const [adjustments, contacts, extensionRows] = await Promise.all([
      charges.listAdjustments(booking.id),
      directory.customerContactsByIds([booking.customerId]),
      extensions.listForBooking(booking.id),
    ]);

    sendSuccess(
      req,
      res,
      {
        qr: toPaymentQrDto(result.qr),
        booking: toBookingDto({
          booking,
          adjustments,
          customerCard: contacts.get(booking.customerId) ?? null,
          extensions: extensionRows,
          revealDriverEarnings: true,
        }),
      },
      message,
      code,
    );
  };

  return {
    create: asyncHandler(async (req, res) => {
      const { id } = bookingIdParamSchema.parse(req.params);
      const result = await useCase.create({ bookingId: id, driverId: principalOf(req) });
      await respond(req, res, result, 'Payment QR ready', 201);
    }),
    status: asyncHandler(async (req, res) => {
      const { id } = bookingIdParamSchema.parse(req.params);
      const result = await useCase.status({ bookingId: id, driverId: principalOf(req) });
      await respond(req, res, result, 'Payment QR');
    }),
  };
}

export function makeDriverPaymentOverrideController(
  useCase: DriverPaymentOverrideUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = paymentOverrideSchema.parse(req.body);

    const booking = await useCase.execute({
      bookingId: id,
      driverId: principalOf(req),
      reason: body.reason,
      note: body.note,
    });

    sendSuccess(
      req,
      res,
      { booking: toBookingDto({ booking, adjustments: [] }) },
      'Payment set to cash — collect it from the customer, then end the trip',
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

/**
 * Roughly how long until the driver reaches the pickup, for the CUSTOMER's two live-trip reads.
 *
 * THE STATUS IS CHECKED BEFORE THE QUERY, not after. `estimatePickupEtaMinutes` would return null
 * for a searching, arrived or finished booking anyway — but only after this function had paid for
 * a position lookup to hand it. The trip screen polls every four seconds for the whole of a trip
 * and only its first stretch can have an answer, so asking first is the difference between a
 * query on every poll and a query on the minority of polls that can use one.
 *
 * NEVER FAILS THE READ. An estimate is a nicety on a screen whose real job is the trip code, the
 * driver's number and the fare; a position lookup that errors must not turn that into an error
 * state. It is logged, and the field goes out null — which the app already renders as silence.
 */
async function etaFor(
  locations: DriverLocationContract,
  booking: { status: BookingStatus; driverId: string | null; pickup: { lat: number; lng: number } },
): Promise<number | null> {
  if (booking.driverId === null) return null;
  if (booking.status !== 'ASSIGNED' && booking.status !== 'DRIVER_EN_ROUTE') return null;

  try {
    const fix = await locations.lastLocationOf(booking.driverId);
    return estimatePickupEtaMinutes({
      status: booking.status,
      pickup: booking.pickup,
      driverAt: fix === null ? null : { lat: fix.lat, lng: fix.lng },
      driverFixAt: fix?.at ?? null,
      now: new Date(),
    });
  } catch (err) {
    logger.warn({ err, driverId: booking.driverId }, 'pickup ETA lookup failed; omitting it');
    return null;
  }
}

/** The customer's own booking, which is the only view that carries the trip code. */
export function makeGetCustomerBookingController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
  directory: DriverCardContract & DriverLocationContract,
  extensions: ExtensionRepositoryPort,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const customerId = principalOf(req);

    const booking = await repo.findById(id);
    if (booking === null || booking.customerId !== customerId) throw new BookingNotFoundError(id);

    const [adjustments, startOtp, driverCard, extensionRows, pickupEtaMinutes] = await Promise.all([
      charges.listAdjustments(booking.id),
      // Shown to the customer so they can read it out — and only ever from here.
      repo.readStartOtp(booking.id),
      cardFor(directory, booking.driverId),
      // Resolved on the single-booking read, not the list: this is the screen with the Extend
      // button on it, and a history list would pay a query per row to render nothing.
      extensions.listForBooking(booking.id),
      // The customer is the only party who needs telling how long the driver will be, and this
      // is the screen they are watching while they wait. See `etaFor`.
      etaFor(directory, booking),
    ]);

    sendSuccess(
      req,
      res,
      toBookingDto({
        booking,
        adjustments,
        startOtp,
        driverCard,
        extensions: extensionRows,
        pickupEtaMinutes,
      }),
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
 * PAGED WHEN ASKED. With `limit`, this is a keyset page, filtered, searched and sorted in the
 * database (`customerHistoryQuerySchema`), with `next_cursor` and, on the first page, the
 * whole-history `summary`. Without `limit` it is the old capped list, so app builds already on
 * phones, which filter client-side over one response, are unchanged.
 *
 * Adjustments are fetched per booking rather than in one query — one page's worth of round trips.
 */
export function makeListCustomerBookingsController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
  directory: DriverCardContract & AccountDirectoryContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const customerId = principalOf(req);
    const query = customerHistoryQuerySchema.parse(req.query);

    let bookings: Booking[];
    let nextCursor: string | null = null;
    let summary: RideHistorySummary | null = null;

    if (query.limit === undefined) {
      bookings = await repo.listForCustomer(customerId, HISTORY_LIMIT);
    } else {
      const search = query.q === undefined || query.q === '' ? undefined : query.q;
      const [page, totals] = await Promise.all([
        (async () =>
          repo.pageForCustomer({
            customerId,
            limit: query.limit as number,
            now: new Date(),
            cursor: query.cursor,
            group: query.group,
            from: query.from,
            before: query.before,
            search,
            // A driver's NAME is identity's to match; this module only ever sees the ids.
            driverIds:
              search === undefined
                ? undefined
                : await directory.idsMatching('DRIVER', search, SEARCH_ACCOUNT_LIMIT),
            sort: query.sort,
          }))(),
        query.cursor === undefined ? repo.customerHistorySummary(customerId) : null,
      ]);
      bookings = page.bookings;
      nextCursor = page.nextCursor === null ? null : encodeHistoryCursor(page.nextCursor);
      summary =
        totals === null
          ? null
          : { total_trips: totals.totalTrips, total_spent: toMoney(totals.totalSpentPaise) };
    }

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

    sendSuccess(
      req,
      res,
      { bookings: dtos, next_cursor: nextCursor, summary } satisfies ListBookingsResponse,
      'Your rides',
    );
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
  directory: AccountDirectoryContract & CustomerContactContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const driverId = principalOf(req);
    const query = driverHistoryQuerySchema.parse(req.query);

    let bookings: Booking[];
    let nextCursor: string | null = null;
    let summary: DriverTripsSummary | null = null;

    if (query.limit === undefined) {
      bookings = await repo.listForDriver(driverId, HISTORY_LIMIT);
    } else {
      const limit = query.limit;
      const search = query.q === undefined || query.q === '' ? undefined : query.q;
      const [page, totals] = await Promise.all([
        (async () =>
          repo.pageForDriver({
            driverId,
            limit,
            cursor: query.cursor,
            group: query.group,
            from: query.from,
            before: query.before,
            search,
            // A customer's NAME is identity's to match; this module only ever sees the ids.
            customerIds:
              search === undefined
                ? undefined
                : await directory.idsMatching('CUSTOMER', search, SEARCH_ACCOUNT_LIMIT),
          }))(),
        query.cursor === undefined ? repo.driverHistorySummary(driverId) : null,
      ]);
      bookings = page.bookings;
      nextCursor = page.nextCursor === null ? null : encodeHistoryCursor(page.nextCursor);
      summary =
        totals === null
          ? null
          : {
              total_trips: totals.totalTrips,
              completed_trips: totals.completedTrips,
              fares: toMoney(totals.faresPaise),
            };
    }

    /*
     * `customerContactsByIds`, NOT `namesByIds`. The latter falls back to the PHONE NUMBER when an
     * account has no name — right for an admin identifying a row, wrong here: this list is full of
     * FINISHED trips, and the number is withheld after a trip ends (`PHONE_VISIBLE_STATUSES`). A
     * customer who never set a name used to appear to their driver as their own phone number.
     * Only the name is read from the contact; the app shows "Customer" when it is null.
     */
    const contacts = await directory.customerContactsByIds([
      // Deduped: a repeat customer must not be looked up once per trip they took.
      ...new Set(bookings.map((booking) => booking.customerId)),
    ]);

    const dtos = await Promise.all(
      bookings.map(async (booking) =>
        toBookingDto({
          booking,
          adjustments: await charges.listAdjustments(booking.id),
          customerName: contacts.get(booking.customerId)?.fullName ?? null,
        }),
      ),
    );

    sendSuccess(
      req,
      res,
      { bookings: dtos, next_cursor: nextCursor, summary } satisfies ListDriverTripsResponse,
      'Your trips',
    );
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
  directory: DriverCardContract & DriverLocationContract,
  extensions: ExtensionRepositoryPort,
  settings: SettingsReadContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const snapshot = await settings.snapshot();
    const booking = await repo.findActiveForCustomer(
      principalOf(req),
      liveAssignmentCutoff(new Date(), snapshot['dispatch.scheduled_lead_minutes']),
    );

    if (booking === null) {
      sendSuccess(req, res, { booking: null }, 'No booking in progress');
      return;
    }

    const [adjustments, startOtp, driverCard, extensionRows, pickupEtaMinutes] = await Promise.all([
      charges.listAdjustments(booking.id),
      repo.readStartOtp(booking.id),
      cardFor(directory, booking.driverId),
      extensions.listForBooking(booking.id),
      // The app asks for this on launch, so it is the read that answers "how long?" for a
      // customer who killed the app at the kerb and reopened it. See `etaFor`.
      etaFor(directory, booking),
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
          pickupEtaMinutes,
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
 *
 * A TRIP BOOKED FOR NEXT WEEK IS NOT "CURRENT", the same rule the customer's `/current` follows
 * for its own scheduled bookings. `gate.tsx` re-routes the driver onto whatever this returns on
 * every launch, so a booking an admin pre-assigned would hold their app hostage until its pickup
 * day. It surfaces in the driver's Upcoming list instead, and becomes this answer at T−lead.
 */
export function makeGetCurrentDriverTripController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
  directory: CustomerContactContract,
  extensions: ExtensionRepositoryPort,
  settings: SettingsReadContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const snapshot = await settings.snapshot();
    const booking = await repo.findActiveForDriver(
      principalOf(req),
      liveAssignmentCutoff(new Date(), snapshot['dispatch.scheduled_lead_minutes']),
    );

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
      ...(body.extrasCollection === undefined ? {} : { extrasCollection: body.extrasCollection }),
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
        // Cash is always allowed (2026-10-13): dues ride on the next trip and the driver collects
        // them with the fare, so neither mode is withheld any more.
        payment_modes: ['UPI', 'CASH'],
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
 * Named on the row's own terms rather than either party's. CARRIES the start OTP: admins book
 * trips on customers' behalf from the panel and have to be able to pass the code on (see the note
 * at the lookup below). Both parties' phone numbers are revealed — see `revealPhones`.
 */
export function makeGetAdminBookingController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
  directory: CustomerContactContract & DriverCardContract,
  extensions: ExtensionRepositoryPort,
  payments: PaymentsContract,
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
    /*
     * THE TRIP CODE TOO — on this single read only, never the list. Admins book trips for
     * customers from the panel now, often for someone without the app, and the code is what the
     * customer must give the driver at pickup. Support also gets asked for it by a customer whose
     * phone has died. A page of every code in the city stays off the list read.
     */
    const [contacts, cards, adjustments, extensionRows, startOtp, paymentRows] = await Promise.all([
      directory.customerContactsByIds([booking.customerId]),
      booking.driverId === null
        ? Promise.resolve(new Map<string, DriverCard>())
        : directory.driverCardsByIds([booking.driverId]),
      charges.listAdjustments(booking.id),
      extensions.listForBooking(booking.id),
      repo.readStartOtp(booking.id),
      payments.listForBooking(booking.id),
    ]);

    /*
     * HOW IT WAS PAID: the fare's captured payment. The newest, if (against the odds) there were
     * two — a duplicate is refunded, so it is no longer captured and is not in this list.
     */
    const paid = paymentRows.filter((p) => p.kind === 'BOOKING' && isCaptured(p.status)).at(-1);

    sendSuccess(
      req,
      res,
      toBookingDto({
        booking,
        adjustments,
        extensions: extensionRows,
        startOtp,
        revealPhones: true,
        onlinePayment:
          paid === undefined ? null : { channel: paid.channel, providerPaymentId: paid.providerPaymentId },
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
