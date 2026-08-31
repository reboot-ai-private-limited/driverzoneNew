import type { ReviewDoc } from './review.model.js';
import { ReviewModel } from './review.model.js';

export class ReviewRepository {
  async createReview(data: Partial<ReviewDoc>): Promise<ReviewDoc> {
    const doc = new ReviewModel(data);
    return doc.save();
  }

  async getReviewByBookingAndReviewer(bookingId: string, reviewerId: string): Promise<ReviewDoc | null> {
    return ReviewModel.findOne({ bookingId, reviewerId }).lean();
  }

  async countReviewsForBooking(bookingId: string): Promise<number> {
    return ReviewModel.countDocuments({ bookingId });
  }

  async markReviewsPublished(bookingId: string): Promise<void> {
    await ReviewModel.updateMany({ bookingId }, { $set: { isPublished: true } });
  }

  async findUnpublishedReviewsBefore(date: Date): Promise<ReviewDoc[]> {
    return ReviewModel.find({ isPublished: false, createdAt: { $lte: date } }).lean();
  }
}
