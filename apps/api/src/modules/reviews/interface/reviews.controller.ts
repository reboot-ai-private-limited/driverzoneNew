import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '@/shared/errors/AppError.js';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { AccountDirectoryContract } from '../../identity/identity.public.js';
import { RateTripInput, type RateTripUseCase } from '../application/useCases/rateTrip.usecase.js';
import type { Review, ReviewRepositoryPort } from '../domain/reviewRepository.port.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Not a valid id.');
const idParam = z.object({ id: objectId });

/** `?reviewee_role=DRIVER&rating_lte=2` — the two the ops list is actually driven by. */
const adminQuery = z.object({
  reviewee_role: z.enum(['CUSTOMER', 'DRIVER']).optional(),
  reviewee_id: objectId.optional(),
  booking_id: objectId.optional(),
  rating_lte: z.coerce.number().int().min(1).max(5).optional(),
  flagged: z.coerce.boolean().optional(),
});

const ADMIN_PAGE_SIZE = 200;

export interface AdminReviewsControllers {
  listAdminReviews: RequestHandler;
  deleteReview: RequestHandler;
  toggleFlagReview: RequestHandler;
}

/**
 * INTERFACE — HTTP in, HTTP out. Every policy question is answered a layer down.
 */
export function makeAdminReviewsControllers(
  repo: ReviewRepositoryPort,
  directory: AccountDirectoryContract,
): AdminReviewsControllers {
  return {
    listAdminReviews: asyncHandler(async (req, res) => {
      const q = adminQuery.parse(req.query);

      const reviews = await repo.listForAdmin(
        {
          revieweeRole: q.reviewee_role,
          revieweeId: q.reviewee_id,
          bookingId: q.booking_id,
          ratingLte: q.rating_lte,
          flaggedOnly: q.flagged,
        },
        ADMIN_PAGE_SIZE,
      );

      sendSuccess(req, res, await withNames(reviews, directory));
    }),

    deleteReview: asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      if (!(await repo.deleteById(id))) throw AppError.notFound('That review does not exist.');

      sendSuccess(req, res, { id }, 'Review deleted');
    }),

    toggleFlagReview: asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);

      const flagged = await repo.toggleFlag(id);
      if (flagged === null) throw AppError.notFound('That review does not exist.');

      sendSuccess(req, res, { id, admin_flagged: flagged }, 'Review flag updated');
    }),
  };
}

/**
 * The rate handler, bound to the role of the router mounting it.
 *
 * `role` is the role of the ROUTER this is mounted on, not a claim read out of the token —
 * `requireAuth` has already refused anyone holding the other audience, so the mount point is the
 * stronger of the two facts. Note what this does NOT read from the request: who is being rated.
 * The reviewer comes from the token and the reviewee comes from the booking, so a caller cannot
 * address a review at someone they never travelled with.
 */
export function makeRateTripController(
  rateTripUc: RateTripUseCase,
  role: 'CUSTOMER' | 'DRIVER',
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const input = RateTripInput.parse(req.body);

    const result = await rateTripUc.execute(id, principalOf(req), role, input);
    sendSuccess(req, res, result, 'Thanks for rating your trip', 201);
  });
}

/**
 * Attaches the display name to each side of every row.
 *
 * TWO queries for the whole page, not two per row: the ids are collected per role first and
 * resolved in one batch each, which is exactly what `namesByIds` exists for.
 */
async function withNames(
  reviews: Review[],
  directory: AccountDirectoryContract,
): Promise<unknown[]> {
  const customerIds: string[] = [];
  const driverIds: string[] = [];
  for (const r of reviews) {
    (r.reviewerRole === 'CUSTOMER' ? customerIds : driverIds).push(r.reviewerId);
    (r.revieweeRole === 'CUSTOMER' ? customerIds : driverIds).push(r.revieweeId);
  }

  const [customers, drivers] = await Promise.all([
    directory.namesByIds('CUSTOMER', customerIds),
    directory.namesByIds('DRIVER', driverIds),
  ]);
  const nameOf = (role: 'CUSTOMER' | 'DRIVER', id: string): string =>
    (role === 'CUSTOMER' ? customers : drivers).get(id) ?? 'Unknown';

  return reviews.map((r) => ({
    id: r.id,
    booking_id: r.bookingId,
    reviewer: { id: r.reviewerId, role: r.reviewerRole, name: nameOf(r.reviewerRole, r.reviewerId) },
    reviewee: { id: r.revieweeId, role: r.revieweeRole, name: nameOf(r.revieweeRole, r.revieweeId) },
    rating: r.rating,
    tags: r.tags,
    comment: r.comment,
    created_at: r.createdAt.toISOString(),
    admin_flagged: r.adminFlagged,
  }));
}

function principalOf(req: Request): string {
  const sub = req.principal?.sub;
  if (sub === undefined) {
    throw AppError.internal('INTERNAL', {
      reason: 'requireAuth ran but left no principal on the request',
    });
  }
  return sub;
}
