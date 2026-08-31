import type { Request, Response, NextFunction } from 'express';
import { RateTripInput, RateTripUseCase } from '../application/useCases/rateTrip.usecase.js';
import { ReviewModel } from '../infrastructure/review.model.js';
import { CustomerModel } from '../../identity/infrastructure/customer.model.js';
import { DriverModel } from '../../identity/infrastructure/driver.model.js';

export interface ReviewsControllers {
  rateTrip: (req: Request, res: Response, next: NextFunction) => Promise<void>;
  listAdminReviews: (req: Request, res: Response, next: NextFunction) => Promise<void>;
  deleteReview: (req: Request, res: Response, next: NextFunction) => Promise<void>;
  toggleFlagReview: (req: Request, res: Response, next: NextFunction) => Promise<void>;
}

export function makeReviewsControllers(rateTripUc: RateTripUseCase): ReviewsControllers {
  return {
    rateTrip: async (req, res, next) => {
      try {
        const bookingId = req.params.id as string;
        const input = RateTripInput.parse(req.body);
        const user = (req as any).user;
        const sub = (user?.sub as string) ?? 'dummy-sub';
        const aud = (user?.aud as string) ?? 'CUSTOMER';
        const reviewerRole = aud as 'CUSTOMER' | 'DRIVER';

        // Normally we'd fetch the booking to get the revieweeId, but we'll simulate passing it
        // from a booking lookup. In a real system, we look up the booking first.
        const revieweeId = 'dummy-reviewee-id'; // Requires actual booking module integration

        const result = await rateTripUc.execute(bookingId, sub, reviewerRole, revieweeId, input);

        res.status(201).json({
          success: true,
          statusCode: 201,
          data: result,
          message: 'Review submitted successfully.',
        });
      } catch (err) {
        next(err);
      }
    },

    listAdminReviews: async (req, res, next) => {
      try {
        const revieweeRole = req.query.reviewee_role === 'CUSTOMER' ? 'CUSTOMER' : 'DRIVER';
        const reviews = await ReviewModel.find({ revieweeRole }).sort({ createdAt: -1 }).lean();

        // Populate names for the admin dashboard
        const data = await Promise.all(
          reviews.map(async (rev) => {
            let reviewerName = 'Unknown';
            let revieweeName = 'Unknown';

            if (rev.reviewerRole === 'CUSTOMER') {
              const cust = await CustomerModel.findById(rev.reviewerId).select('fullName phone').lean();
              reviewerName = cust?.fullName || cust?.phone || 'Unknown Customer';
            } else {
              const drv = await DriverModel.findById(rev.reviewerId).select('fullName phone').lean();
              reviewerName = drv?.fullName || drv?.phone || 'Unknown Driver';
            }

            if (rev.revieweeRole === 'CUSTOMER') {
              const cust = await CustomerModel.findById(rev.revieweeId).select('fullName phone').lean();
              revieweeName = cust?.fullName || cust?.phone || 'Unknown Customer';
            } else {
              const drv = await DriverModel.findById(rev.revieweeId).select('fullName phone').lean();
              revieweeName = drv?.fullName || drv?.phone || 'Unknown Driver';
            }

            return {
              id: rev._id.toString(),
              booking_id: rev.bookingId.toString(),
              reviewer: { id: rev.reviewerId.toString(), role: rev.reviewerRole, name: reviewerName },
              reviewee: { id: rev.revieweeId.toString(), role: rev.revieweeRole, name: revieweeName },
              rating: rev.rating,
              tags: rev.tags,
              comment: rev.comment,
              created_at: rev.createdAt.toISOString(),
              admin_flagged: rev.adminFlagged,
            };
          })
        );

        res.json({
          success: true,
          statusCode: 200,
          data,
          meta: { total: data.length, page: 1 },
        });
      } catch (err) {
        next(err);
      }
    },

    deleteReview: async (req, res, next) => {
      try {
        const id = req.params.id;
        await ReviewModel.findByIdAndDelete(id);

        res.json({
          success: true,
          statusCode: 200,
          message: 'Review deleted successfully',
          data: { id },
        });
      } catch (err) {
        next(err);
      }
    },

    toggleFlagReview: async (req, res, next) => {
      try {
        const id = req.params.id;
        const review = await ReviewModel.findById(id);
        if (!review) {
          const err = new Error('Not found');
          (err as any).statusCode = 404;
          throw err;
        }

        review.adminFlagged = !review.adminFlagged;
        await review.save();

        res.json({
          success: true,
          statusCode: 200,
          message: 'Review flag updated successfully',
          data: { id, admin_flagged: review.adminFlagged },
        });
      } catch (err) {
        next(err);
      }
    },
  };
}
