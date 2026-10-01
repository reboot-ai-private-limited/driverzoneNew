import type { Request, RequestHandler, Response } from 'express';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import { AppError } from '../../../shared/errors/AppError.js';
import type { CreateQuoteUseCase } from '../application/useCases/createQuote.usecase.js';
import type { ExplainTripUseCase } from '../application/useCases/explainTrip.usecase.js';
import {
  adminQuoteCustomerSchema,
  createQuoteSchema,
  explainTripQuerySchema,
  type CreateQuoteInputParsed,
} from './quotes.validation.js';
import { toCreateQuoteResponse, toExplainTripResponse } from './quotes.mapper.js';

export function makeCreateQuoteController(useCase: CreateQuoteUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const body = createQuoteSchema.parse(req.body);

    const customerId = req.principal?.sub;
    if (customerId === undefined) {
      throw AppError.internal('INTERNAL', {
        reason: 'requireAuth ran but left no principal on the request',
      });
    }

    await quoteFor(useCase, customerId, body, req, res);
  });
}

/**
 * `POST /admin/quotes` — the same quote, for a customer the ADMIN names.
 *
 * `customer_id` is split off before the rest goes through the customer's own schema unchanged, so
 * the two endpoints cannot drift apart on what a trip request may contain. Whether the customer
 * exists is checked when the BOOKING is made (`POST /admin/bookings`) — a quote for a stray id
 * books nothing, and this module cannot see accounts.
 */
export function makeAdminCreateQuoteController(useCase: CreateQuoteUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { customer_id: customerId, ...rest } = adminQuoteCustomerSchema.parse(req.body);
    const body = createQuoteSchema.parse(rest);
    await quoteFor(useCase, customerId, body, req, res);
  });
}

async function quoteFor(
  useCase: CreateQuoteUseCase,
  customerId: string,
  body: CreateQuoteInputParsed,
  req: Request,
  res: Response,
): Promise<void> {
  const result = await useCase.execute({
    customerId,
    pickup: body.pickup,
    drop: body.drop,
    ...(body.scheduledAt === undefined ? {} : { scheduledAt: body.scheduledAt }),
    ...(body.direction === undefined ? {} : { direction: body.direction }),
    ...(body.returnAt === undefined ? {} : { returnAt: body.returnAt }),
    ...(body.insurance === undefined ? {} : { insurance: body.insurance }),
  });

  /*
   * A 200 with `available: false`, NOT a 4xx. "We don't serve your pickup point yet" is the
   * system working correctly — it belongs on a helpful screen in the app, and it must stay out
   * of the error dashboards where a genuine fault would then be lost among it.
   */
  if (!result.available) {
    sendSuccess(req, res, result, result.message);
    return;
  }

  sendSuccess(req, res, toCreateQuoteResponse(result), 'Quote created');
}

/**
 * `GET /admin/quotes/explain` — which product a trip resolves to, and why.
 *
 * THE DIAGNOSTIC FOR "this in-city trip was charged as outstation". Returns the domain shape
 * almost verbatim: there is no app rendering this to keep a wire contract stable for, and an
 * admin reading a zone id needs the zone id, not a prettier name for it.
 */
export function makeExplainTripController(useCase: ExplainTripUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const q = explainTripQuerySchema.parse(req.query);

    const result = await useCase.execute({
      pickup: { lat: q.pickup_lat, lng: q.pickup_lng },
      drop: { lat: q.drop_lat, lng: q.drop_lng },
      ...(q.direction === undefined ? {} : { direction: q.direction }),
    });

    sendSuccess(req, res, toExplainTripResponse(result), 'Trip resolution');
  });
}
