import type { RequestHandler } from 'express';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import { AppError } from '../../../shared/errors/AppError.js';
import type { CreateQuoteUseCase } from '../application/useCases/createQuote.usecase.js';
import { createQuoteSchema } from './quotes.validation.js';
import { toCreateQuoteResponse } from './quotes.mapper.js';

export function makeCreateQuoteController(useCase: CreateQuoteUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const body = createQuoteSchema.parse(req.body);

    const customerId = req.principal?.sub;
    if (customerId === undefined) {
      throw AppError.internal('INTERNAL', {
        reason: 'requireAuth ran but left no principal on the request',
      });
    }

    const result = await useCase.execute({
      customerId,
      pickup: body.pickup,
      drop: body.drop,
      ...(body.scheduledAt === undefined ? {} : { scheduledAt: body.scheduledAt }),
      ...(body.direction === undefined ? {} : { direction: body.direction }),
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
  });
}
