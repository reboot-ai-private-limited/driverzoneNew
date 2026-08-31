import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { toMoney } from '../../../shared/money/format.js';
import type { BookingDispatchContract } from '../../bookings/bookings.public.js';
import type { OfferRepositoryPort } from '../domain/ports.js';
import type {
  AcceptOfferUseCase,
  DeclineOfferUseCase,
} from '../application/useCases/respondToOffer.usecase.js';

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
 * "What is ringing on my phone right now."
 *
 * The recovery path after an app restart mid-offer. Without it a driver who was killed by the
 * OEM battery manager — which is most of them, most days — comes back to a blank screen with a
 * live offer they cannot see, and it lapses against their acceptance rate.
 */
export function makeCurrentOfferController(
  offers: OfferRepositoryPort,
  bookings: BookingDispatchContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const offer = await offers.findLiveForDriver(driverOf(req));
    if (offer === null) {
      sendSuccess(req, res, { offer: null }, 'No live offer');
      return;
    }

    const booking = await bookings.findById(offer.bookingId);
    if (booking === null) {
      sendSuccess(req, res, { offer: null }, 'No live offer');
      return;
    }

    sendSuccess(
      req,
      res,
      {
        offer: {
          offer_id: offer.id,
          booking_id: booking.id,
          reference: booking.reference,
          expires_at: offer.expiresAt.toISOString(),
          earning: toMoney(booking.fareSnapshot.fare.split.driverPaise),
          pickup: { ...booking.pickup, address: booking.pickupAddress },
          scheduled_at: booking.scheduledAt.toISOString(),
          service_type: booking.serviceType,
        },
      },
      'Live offer',
    );
  });
}
