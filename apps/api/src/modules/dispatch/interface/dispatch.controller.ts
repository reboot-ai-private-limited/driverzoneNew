import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { toMoney } from '../../../shared/money/format.js';
import type { BookingDispatchContract } from '../../bookings/bookings.public.js';
import type { OfferRepositoryPort } from '../domain/ports.js';
import type { AssignableDriversContract } from '../../identity/identity.public.js';
import type {
  AcceptOfferUseCase,
  DeclineOfferUseCase,
} from '../application/useCases/respondToOffer.usecase.js';
import type { ScheduledBoardUseCase } from '../application/useCases/scheduledBoard.usecase.js';
import type { TransferBookingUseCase } from '../application/useCases/transferBooking.usecase.js';
import { requirementFromBooking, vehicleMismatchReason } from '../domain/vehicleCompatibility.js';

const offerIdParamSchema = z.object({ id: z.string().min(1) });

function driverOf(req: Request): string {
  const sub = req.principal?.sub;
  if (sub === undefined) {
    throw AppError.internal('INTERNAL', {
      reason: 'requireAuth ran but left no principal on the request',
    });
  }
  return sub;
}

/**
 * Accepting.
 *
 * LOSING THE RACE IS A 200, not an error. Four of five drivers lose every wave, and every one of
 * them did exactly what was asked — reporting that as a failure would put normal, correct
 * behaviour into the error dashboards and make a genuine dispatch fault impossible to see.
 */
export function makeAcceptOfferController(useCase: AcceptOfferUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = offerIdParamSchema.parse(req.params);
    const result = await useCase.execute(id, driverOf(req));

    if (!result.claimed) {
      sendSuccess(
        req,
        res,
        { claimed: false, reason: result.reason, message: result.message },
        result.message,
      );
      return;
    }

    sendSuccess(
      req,
      res,
      {
        claimed: true,
        booking_id: result.booking.id,
        reference: result.booking.reference,
        pickup: { ...result.booking.pickup, address: result.booking.pickupAddress },
        drop: { ...result.booking.drop, address: result.booking.dropAddress },
        scheduled_at: result.booking.scheduledAt.toISOString(),
        earning: toMoney(result.booking.fareSnapshot.fare.split.driverPaise),
      },
      'Trip accepted',
    );
  });
}

export function makeDeclineOfferController(useCase: DeclineOfferUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = offerIdParamSchema.parse(req.params);
    await useCase.execute(id, driverOf(req));
    sendSuccess(req, res, { declined: true }, 'Offer declined');
  });
}

/**
 * "What is ringing on my phone right now" — every offer, soonest-expiring first.
 *
 * THE RECOVERY PATH after an app restart mid-offer, same as the singular version this replaced.
 * Without it a driver who was killed by the OEM battery manager — which is most of them, most
 * days — comes back to a blank screen with a live offer they cannot see, and it lapses against
 * their acceptance rate.
 *
 * PLURAL NOW (2026-09-04). A driver can legitimately hold more than one live offer — dispatch's
 * matching does not exclude a driver who already has one open, and that is deliberate. The old
 * `findOne` version returned an arbitrary one of them and let the app's ring screen render a
 * different offer than the one its Accept button was about to act on; this returns the truth.
 */
export function makeListOffersController(
  offers: OfferRepositoryPort,
  bookings: BookingDispatchContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const live = await offers.findAllLiveForDriver(driverOf(req));

    /*
     * A booking missing under a still-SENT offer is the one-offer controller's `booking === null`
     * case, carried over — filtered out here rather than failing the whole list, so a driver's
     * other, healthy offer does not disappear because one row points at a booking that is gone.
     */
    const dtos = (
      await Promise.all(
        live.map(async (offer) => {
          const booking = await bookings.findById(offer.bookingId);
          if (booking === null) return null;

          return {
            offer_id: offer.id,
            booking_id: booking.id,
            reference: booking.reference,
            expires_at: offer.expiresAt.toISOString(),
            earning: toMoney(booking.fareSnapshot.fare.split.driverPaise),
            pickup: { ...booking.pickup, address: booking.pickupAddress },
            drop: { ...booking.drop, address: booking.dropAddress },
            scheduled_at: booking.scheduledAt.toISOString(),
            service_type: booking.serviceType,
          };
        }),
      )
    ).filter((dto): dto is NonNullable<typeof dto> => dto !== null);

    sendSuccess(req, res, { offers: dtos }, dtos.length === 0 ? 'No live offers' : 'Live offers');
  });
}

// ─── Admin: manual assignment ────────────────────────────────────────────────────────────────

const assignableQuerySchema = z.object({
  search: z.string().trim().max(120).optional().default(''),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  booking_id: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Not a valid booking id.')
    .optional(),
});

const assignSchema = z
  .object({
    driver_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Not a valid driver id.'),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

const bookingIdParamSchema = z.object({ id: z.string().min(1) });

function adminOf(req: Request): string {
  const sub = req.principal?.sub;
  if (sub === undefined) {
    throw AppError.internal('INTERNAL', {
      reason: 'requireAuth ran but left no principal on the request',
    });
  }
  return sub;
}

/**
 * `GET /admin/bookings/assignable-drivers?search=&booking_id=`.
 *
 * `is_on_duty` rides along so the panel can WARN rather than hide. An admin assigning an off-duty
 * driver has almost always just phoned them, which is the case manual assignment exists for.
 *
 * `vehicle_compatible` is the same kind of warning, not a gate — `null` when no `booking_id` was
 * given (or it did not resolve), `true`/`false` otherwise. `TransferBookingUseCase` is the actual
 * gate; this only lets the picker flag a mismatch before the admin wastes a round trip on one.
 */
export function makeAssignableDriversController(
  drivers: AssignableDriversContract,
  bookings: BookingDispatchContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { search, limit, booking_id } = assignableQuerySchema.parse(req.query);

    const [found, booking] = await Promise.all([
      drivers.assignableDrivers(search, limit),
      booking_id === undefined ? Promise.resolve(null) : bookings.findById(booking_id),
    ]);
    const requirement = booking === null ? null : requirementFromBooking(booking);

    sendSuccess(
      req,
      res,
      found.map((driver) => ({
        id: driver.id,
        name: driver.fullName,
        phone: driver.phone,
        is_on_duty: driver.isOnDuty,
        vehicle_compatible:
          requirement === null ? null : vehicleMismatchReason(driver, requirement) === null,
      })),
    );
  });
}

/** `POST /admin/bookings/:id/assign` — release whoever has it, hand it to the chosen driver. */
export function makeAssignDriverController(useCase: TransferBookingUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const body = assignSchema.parse(req.body);

    const result = await useCase.execute({
      bookingId: id,
      toDriverId: body.driver_id,
      reason: body.reason,
      adminId: adminOf(req),
    });

    sendSuccess(
      req,
      res,
      {
        booking_id: result.booking.id,
        reference: result.booking.reference,
        driver_id: result.booking.driverId,
        released_driver_id: result.releasedDriverId,
      },
      'Trip transferred',
    );
  });
}

// ─── The scheduled board ────────────────────────────────────────────────────────────────────

/**
 * `GET /driver/scheduled-bookings` — parked trips this driver could take.
 *
 * NO PAGINATION, and a cap in the use case instead. A board with hundreds of parked bookings on
 * it is not a paging problem, it is a dispatch emergency — and the answer to that is the ops
 * screen, not a second page here.
 */
export function makeListScheduledBoardController(useCase: ScheduledBoardUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const bookings = await useCase.list(driverOf(req));

    const dtos = bookings.map((booking) => ({
      booking_id: booking.id,
      reference: booking.reference,
      earning: toMoney(booking.fareSnapshot.fare.split.driverPaise),
      pickup: { ...booking.pickup, address: booking.pickupAddress },
      drop: { ...booking.drop, address: booking.dropAddress },
      scheduled_at: booking.scheduledAt.toISOString(),
      service_type: booking.serviceType,
      estimated_minutes: booking.fareSnapshot.included.minutes ?? 0,
    }));

    sendSuccess(
      req,
      res,
      { bookings: dtos },
      dtos.length === 0 ? 'No scheduled trips waiting' : 'Scheduled trips waiting for a driver',
    );
  });
}

/**
 * `POST /driver/scheduled-bookings/:id/accept`.
 *
 * A LOST RACE IS A 200. Same rule as the ring screen's accept: two drivers can be looking at this
 * board at once and the slower one did nothing wrong. Clients branch on `claimed`.
 */
export function makeAcceptScheduledBookingController(
  useCase: ScheduledBoardUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = bookingIdParamSchema.parse(req.params);
    const result = await useCase.accept(id, driverOf(req));

    if (!result.claimed) {
      sendSuccess(
        req,
        res,
        { claimed: false, reason: result.reason, message: result.message },
        result.message,
      );
      return;
    }

    const booking = result.booking;
    sendSuccess(
      req,
      res,
      {
        claimed: true,
        booking_id: booking.id,
        reference: booking.reference,
        pickup: { ...booking.pickup, address: booking.pickupAddress },
        drop: { ...booking.drop, address: booking.dropAddress },
        scheduled_at: booking.scheduledAt.toISOString(),
        earning: toMoney(booking.fareSnapshot.fare.split.driverPaise),
      },
      'Trip is yours',
    );
  });
}
