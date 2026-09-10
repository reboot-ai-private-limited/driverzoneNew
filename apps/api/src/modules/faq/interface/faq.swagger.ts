import { z } from 'zod';
import { bearerAuth, errorResponse, registry, successResponse } from '@/shared/http/swagger.util.js';
import { replaceFaqsSchema } from './faq.validation.js';

/**
 * INTERFACE — OpenAPI paths, generated from the exact schema `faq.validation.ts` validates the
 * request with (`swagger.util.ts` explains why that matters). The response DTO below mirrors
 * `@driverzone/contracts`'s `faq.ts` field-for-field; those are hand-written interfaces, not Zod,
 * so this is the one place their shape is re-declared.
 */

const faqDtoSchema = z.object({
  id: z.string(),
  question: z.string().openapi({ example: 'Who pays for the driver’s meals on a long trip?' }),
  answer: z.string().openapi({
    example:
      'You do, directly to the driver, and it is not part of the fare shown in the app. Allow ₹200 per day.',
  }),
  sort_order: z.number().int().openapi({ description: 'Ascending, dense from 0. Assigned by the server.' }),
  is_published: z.boolean(),
  updated_at: z.string(),
});

const faqListResponseSchema = z.object({ faqs: z.array(faqDtoSchema) });

const jsonError = { content: { 'application/json': { schema: errorResponse } } };
const unauthenticated = { description: 'Missing or invalid bearer token', ...jsonError };
const forbidden = { description: 'Valid token, wrong role', ...jsonError };
const badRequest = { description: 'A malformed entry — empty question, over-long answer', ...jsonError };
const staleList = {
  description: 'The list names an FAQ that no longer exists — someone else deleted it',
  ...jsonError,
};

export function registerFaqSwaggerPaths(): void {
  registry.registerPath({
    method: 'get',
    path: '/admin/faq',
    tags: ['FAQs'],
    summary: 'List every FAQ, drafts included',
    description:
      'The admin view: published and unpublished entries alike, in display order. The apps get ' +
      'the published ones only — see the customer and driver routes.',
    security: bearerAuth,
    responses: {
      200: { description: 'FAQs', content: { 'application/json': { schema: successResponse(faqListResponseSchema) } } },
      401: unauthenticated,
      403: forbidden,
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/admin/faq',
    tags: ['FAQs'],
    summary: 'Replace the whole FAQ list',
    description:
      'The body is the entire list in the order it should read. An entry with no `id` is created; ' +
      'a stored entry whose id is absent from the array is DELETED. `sort_order` is assigned from ' +
      'array position and must not be sent — reordering is the ordinary edit here, and it moves ' +
      'every row at once, which is why there is no per-row route.',
    security: bearerAuth,
    request: { body: { content: { 'application/json': { schema: replaceFaqsSchema } } } },
    responses: {
      200: { description: 'Saved', content: { 'application/json': { schema: successResponse(faqListResponseSchema) } } },
      400: badRequest,
      401: unauthenticated,
      403: forbidden,
      422: staleList,
    },
  });

  for (const audience of ['customer', 'driver'] as const) {
    registry.registerPath({
      method: 'get',
      path: `/${audience}/faq`,
      tags: ['FAQs'],
      summary: `FAQs visible to a ${audience}`,
      description:
        'Published entries only, in display order. Both apps receive the SAME list — the answers ' +
        'describe a trip both sides are on, and two versions of that is the argument the FAQs ' +
        'exist to prevent.',
      security: bearerAuth,
      responses: {
        200: { description: 'FAQs', content: { 'application/json': { schema: successResponse(faqListResponseSchema) } } },
        401: unauthenticated,
        403: forbidden,
      },
    });
  }
}
