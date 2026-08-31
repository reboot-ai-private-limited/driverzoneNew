import type { Request, RequestHandler } from 'express';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { toMoney } from '../../../shared/money/format.js';
import type { BookingRepositoryPort } from '../domain/bookingRepository.port.js';
import type { ChargeRepositoryPort } from '../domain/chargeRepository.port.js';
import { BookingNotFoundError } from '../domain/booking.errors.js';
import type { CreateBookingUseCase } from '../application/useCases/createBooking.usecase.js';
import type {
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
import { toBookingDto, toBookingEventDto } from './bookings.mapper.js';
import {
  bookingIdParamSchema,
  cancelBookingSchema,
  completeTripSchema,
  createBookingSchema,
  driverArrivedSchema,
  forceArriveSchema,
  reportPinSchema,
  startTripSchema,
} from './bookings.validation.js';

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

    const { booking, clientToken } = await useCase.execute({
      customerId: principalOf(req),
      quoteId: body.quoteId,
      pickupAddress: body.pickupAddress,
      dropAddress: body.dropAddress,
      idempotencyKey: idempotencyKeyOf(req),
    });

    sendSuccess(
      req,
      res,
      {
        booking: toBookingDto({ booking, adjustments: [] }),
        client_token: clientToken,
      },
      'Booking created — awaiting payment',
      201,
    );
  });
}

/** The customer's own booking, which is the only view that carries the trip code. */
export function makeGetCustomerBookingController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const customerId = principalOf(req);

    const booking = await repo.findById(id);
    if (booking === null || booking.customerId !== customerId) throw new BookingNotFoundError(id);

    const [adjustments, startOtp] = await Promise.all([
      charges.listAdjustments(booking.id),
      // Shown to the customer so they can read it out — and only ever from here.
      repo.readStartOtp(booking.id),
    ]);

    sendSuccess(req, res, toBookingDto({ booking, adjustments, startOtp }), 'Booking');
  });
}

/** The driver's view of the same booking. No trip code, deliberately. */
export function makeGetDriverBookingController(
  repo: BookingRepositoryPort,
  charges: ChargeRepositoryPort,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const driverId = principalOf(req);

    const booking = await repo.findById(id);
    if (booking === null || booking.driverId !== driverId) throw new BookingNotFoundError(id);

    const adjustments = await charges.listAdjustments(booking.id);
    sendSuccess(req, res, toBookingDto({ booking, adjustments }), 'Booking');
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
