import { z } from 'zod';
import { bearerAuth, errorResponse, registry, successResponse } from '@/shared/http/swagger.util.js';
import { RateTripInput } from '../application/useCases/rateTrip.usecase.js';

// ─── Response DTOs ──────────────────────────────────────────────────────────────────────────

const ReviewDto = z.object({
  id: z.string(),
  booking_id: z.string(),
  reviewer: z.object({
    id: z.string(),
    role: z.enum(['CUSTOMER', 'DRIVER']),
    name: z.string(),
  }),
  reviewee: z.object({
    id: z.string(),
    role: z.enum(['CUSTOMER', 'DRIVER']),
    name: z.string(),
  }),
  rating: z.number(),
  tags: z.array(z.string()),
  comment: z.string().nullable(),
  created_at: z.string().datetime(),
  admin_flagged: z.boolean(),
});

const ReviewListResponse = z.object({
  data: z.array(ReviewDto),
  meta: z.object({ total: z.number(), page: z.number() }),
});

const ReviewActionResponse = z.object({
  data: z.object({ id: z.string(), admin_flagged: z.boolean().optional() }),
});

// ─── Shared error entries ───────────────────────────────────────────────────────────────────

const jsonError = { content: { 'application/json': { schema: errorResponse } } };
const badRequest = { description: 'Invalid input', ...jsonError };
const forbidden = { description: 'Forbidden', ...jsonError };
const notFound = { description: 'Review not found', ...jsonError };
const conflict = { description: 'Already rated this trip', ...jsonError };

// ─── Registration ───────────────────────────────────────────────────────────────────────────

export function registerReviewsSwaggerPaths(): void {
  // Customer Rate Trip
  registry.registerPath({
    method: 'post',
    path: '/v1/customer/bookings/{id}/rate',
    tags: ['Customer'],
    summary: 'Rate a trip as a customer',
    security: bearerAuth,
    request: {
      params: z.object({ id: z.string().openapi({ description: 'Booking ID' }) }),
      body: {
        content: { 'application/json': { schema: RateTripInput } },
      },
    },
    responses: {
      201: { description: 'Review submitted', content: { 'application/json': { schema: successResponse(z.object({ id: z.string(), rating: z.number() })) } } },
      400: badRequest,
      403: forbidden,
      409: conflict,
    },
  });

  // Driver Rate Trip
  registry.registerPath({
    method: 'post',
    path: '/v1/driver/bookings/{id}/rate',
    tags: ['Driver'],
    summary: 'Rate a trip as a driver',
    security: bearerAuth,
    request: {
      params: z.object({ id: z.string().openapi({ description: 'Booking ID' }) }),
      body: {
        content: { 'application/json': { schema: RateTripInput } },
      },
    },
    responses: {
      201: { description: 'Review submitted', content: { 'application/json': { schema: successResponse(z.object({ id: z.string(), rating: z.number() })) } } },
      400: badRequest,
      403: forbidden,
      409: conflict,
    },
  });

  // Admin List Reviews
  registry.registerPath({
    method: 'get',
    path: '/v1/admin/reviews',
    tags: ['Admin'],
    summary: 'List trip reviews',
    security: bearerAuth,
    request: {
      query: z.object({
        reviewee_role: z.enum(['CUSTOMER', 'DRIVER']).optional(),
      }),
    },
    responses: {
      200: { description: 'Reviews retrieved', content: { 'application/json': { schema: successResponse(ReviewListResponse) } } },
      403: forbidden,
    },
  });

  // Admin Toggle Flag
  registry.registerPath({
    method: 'patch',
    path: '/v1/admin/reviews/{id}/flag',
    tags: ['Admin'],
    summary: 'Toggle the hidden/flagged state of a review',
    security: bearerAuth,
    request: {
      params: z.object({ id: z.string().openapi({ description: 'Review ID' }) }),
    },
    responses: {
      200: { description: 'Review flag toggled', content: { 'application/json': { schema: successResponse(ReviewActionResponse) } } },
      403: forbidden,
      404: notFound,
    },
  });

  // Admin Delete Review
  registry.registerPath({
    method: 'delete',
    path: '/v1/admin/reviews/{id}',
    tags: ['Admin'],
    summary: 'Permanently delete a fraudulent or abusive review',
    security: bearerAuth,
    request: {
      params: z.object({ id: z.string().openapi({ description: 'Review ID' }) }),
    },
    responses: {
      200: { description: 'Review deleted', content: { 'application/json': { schema: successResponse(ReviewActionResponse) } } },
      403: forbidden,
    },
  });
}
