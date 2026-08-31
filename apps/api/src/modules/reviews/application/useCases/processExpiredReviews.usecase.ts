import { ReviewModel } from '../../infrastructure/review.model.js';
import { CustomerModel } from '../../../identity/infrastructure/customer.model.js';
import { DriverModel } from '../../../identity/infrastructure/driver.model.js';

export class ProcessExpiredReviewsUseCase {
  async execute(submissionWindowHours: number) {
    const expiryDate = new Date(Date.now() - submissionWindowHours * 60 * 60 * 1000);

    // 1. Find all unpublished reviews older than the submission window
    const expiredReviews = await ReviewModel.find({
      isPublished: false,
      createdAt: { $lte: expiryDate },
    });

    if (expiredReviews.length === 0) return;

    // 2. Mark them as published
    const ids = expiredReviews.map((r) => r._id);
    await ReviewModel.updateMany({ _id: { $in: ids } }, { $set: { isPublished: true } });

    // 3. For each unique reviewee, recalculate the average
    const revieweeIds = [...new Set(expiredReviews.map((r) => r.revieweeId.toString()))];

    for (const revieweeId of revieweeIds) {
      await this.recalculateAverage(revieweeId);
    }
  }

  async recalculateAverage(revieweeId: string) {
    // Get last 100 published reviews for this user
    const recentReviews = await ReviewModel.find({
      revieweeId,
      isPublished: true,
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('rating revieweeRole')
      .lean();

    if (recentReviews.length === 0) return;

    const total = recentReviews.reduce((sum, r) => sum + r.rating, 0);
    const average = total / recentReviews.length;
    const role = recentReviews[0]?.revieweeRole;

    if (role === 'DRIVER') {
      await DriverModel.updateOne(
        { _id: revieweeId },
        { $set: { rating: average, ratingCount: recentReviews.length } }
      );
    } else if (role === 'CUSTOMER') {
      await CustomerModel.updateOne(
        { _id: revieweeId },
        { $set: { rating: average, ratingCount: recentReviews.length } }
      );
    }
  }
}
