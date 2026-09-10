import type { RequestHandler } from 'express';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import { AppError } from '@/shared/errors/AppError.js';
import type { ActorContext } from '../application/actorContext.js';
import type { ListFaqsUseCase } from '../application/useCases/listFaqs.usecase.js';
import type { ListPublishedFaqsUseCase } from '../application/useCases/listPublishedFaqs.usecase.js';
import type { ReplaceFaqsUseCase } from '../application/useCases/replaceFaqs.usecase.js';
import { toFaqDto } from './faq.mapper.js';
import { replaceFaqsSchema } from './faq.validation.js';

/**
 * The admin behind a write. `requireAuth('ADMIN')` guards every route that reaches here, so a
 * missing principal is a wiring fault rather than an unauthenticated caller — hence a 500, not a
 * 401, which would tell the admin to sign in again for a problem signing in cannot fix. Same
 * reasoning, same shape as `settings.controller.ts`.
 */
function actorFrom(req: Parameters<RequestHandler>[0]): ActorContext {
  const adminId = req.principal?.sub;
  if (adminId === undefined) {
    throw AppError.internal('INTERNAL', { reason: 'faq write route reached without a principal' });
  }
  return { adminId, ip: req.ip };
}

export function makeListFaqsController(useCase: ListFaqsUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const faqs = await useCase.execute();
    sendSuccess(req, res, { faqs: faqs.map(toFaqDto) }, 'FAQs');
  });
}

export function makeReplaceFaqsController(useCase: ReplaceFaqsUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { faqs } = replaceFaqsSchema.parse(req.body);
    const saved = await useCase.execute(
      faqs.map((faq) => ({
        ...(faq.id === undefined ? {} : { id: faq.id }),
        question: faq.question,
        answer: faq.answer,
        isPublished: faq.is_published,
      })),
      actorFrom(req),
    );
    sendSuccess(req, res, { faqs: saved.map(toFaqDto) }, 'FAQs saved');
  });
}

/**
 * The customer and driver read surface — one controller for both routes.
 *
 * It takes no audience at all, unlike the settings equivalent, because there is nothing to filter
 * BY: both apps get the same published list on purpose. An FAQ about who pays for the driver's
 * dinner is a fact about the trip, and the two sides of that trip reading different answers is
 * the argument these FAQs exist to prevent.
 */
export function makePublishedFaqsController(useCase: ListPublishedFaqsUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const faqs = await useCase.execute();
    sendSuccess(req, res, { faqs: faqs.map(toFaqDto) }, 'FAQs');
  });
}
