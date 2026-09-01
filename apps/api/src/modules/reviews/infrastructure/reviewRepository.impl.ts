import mongoose from 'mongoose';
import type {
  AdminReviewFilter,
  NewReview,
  Review,
  ReviewRepositoryPort,
} from '../domain/reviewRepository.port.js';
import { ReviewModel } from './review.model.js';

/**
 * INFRASTRUCTURE — the port, over the `reviews` collection.
 *
 * Every method returns plain data with string ids, never a Mongoose document: the use cases do
 * arithmetic and policy, and handing them a live document invites a `.save()` in the middle of
 * one. ObjectId conversion is contained here and nowhere else.
 */
export class MongoReviewRepository implements ReviewRepositoryPort {
  async createReview(data: NewReview): Promise<Review> {
    const doc = await ReviewModel.create({
      ...data,
      bookingId: new mongoose.Types.ObjectId(data.bookingId),
      reviewerId: new mongoose.Types.ObjectId(data.reviewerId),
      revieweeId: new mongoose.Types.ObjectId(data.revieweeId),
      isPublished: false,
    });
    return toReview(doc.toObject());
  }

  async getReviewByBookingAndReviewer(bookingId: string, reviewerId: string): Promise<Review | null> {
    const doc = await ReviewModel.findOne({ bookingId, reviewerId }).lean().exec();
    return doc === null ? null : toReview(doc);
  }

  async countReviewsForBooking(bookingId: string): Promise<number> {
    return ReviewModel.countDocuments({ bookingId }).exec();
  }

  /** Publishes both sides of one booking. Returns the reviewees whose average is now stale. */
  async markReviewsPublished(bookingId: string): Promise<string[]> {
    const affected = await ReviewModel.find({ bookingId, isPublished: false })
      .select('revieweeId')
      .lean()
      .exec();
    if (affected.length === 0) return [];

    await ReviewModel.updateMany({ bookingId }, { $set: { isPublished: true } }).exec();
    return affected.map((r) => String(r.revieweeId));
  }

  /**
   * The sweep's half: everything still blind past the deadline.
   *
   * Reads the ids first and updates by id rather than re-running the predicate, so a review
   * written between the two statements is left for the next pass instead of being published a
   * moment early.
   */
  async publishUnreleasedBefore(cutoff: Date): Promise<string[]> {
    const stale = await ReviewModel.find({ isPublished: false, createdAt: { $lte: cutoff } })
      .select('revieweeId')
      .limit(500)
      .lean()
      .exec();
    if (stale.length === 0) return [];

    await ReviewModel.updateMany(
      { _id: { $in: stale.map((r) => r._id) } },
      { $set: { isPublished: true } },
    ).exec();
    return stale.map((r) => String(r.revieweeId));
  }

  /** The rolling window the cached average is computed over. Newest first. */
  async recentPublishedFor(revieweeId: string, limit: number): Promise<Review[]> {
    const docs = await ReviewModel.find({ revieweeId, isPublished: true })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
    return docs.map(toReview);
  }

  async listForAdmin(filter: AdminReviewFilter, limit: number): Promise<Review[]> {
    const query: Record<string, unknown> = {};
    if (filter.revieweeRole !== undefined) query['revieweeRole'] = filter.revieweeRole;
    if (filter.revieweeId !== undefined) query['revieweeId'] = filter.revieweeId;
    if (filter.bookingId !== undefined) query['bookingId'] = filter.bookingId;
    if (filter.ratingLte !== undefined) query['rating'] = { $lte: filter.ratingLte };
    if (filter.flaggedOnly === true) query['adminFlagged'] = true;

    const docs = await ReviewModel.find(query).sort({ createdAt: -1 }).limit(limit).lean().exec();
    return docs.map(toReview);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await ReviewModel.deleteOne({ _id: id }).exec();
    return result.deletedCount > 0;
  }

  /** Returns the new flag state, or null if there is no such review. */
  async toggleFlag(id: string): Promise<boolean | null> {
    const doc = await ReviewModel.findById(id).select('adminFlagged').lean().exec();
    if (doc === null) return null;

    const next = !doc.adminFlagged;
    await ReviewModel.updateOne({ _id: id }, { $set: { adminFlagged: next } }).exec();
    return next;
  }
}

function toReview(doc: {
  _id: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  reviewerId: mongoose.Types.ObjectId;
  reviewerRole: 'CUSTOMER' | 'DRIVER';
  revieweeId: mongoose.Types.ObjectId;
  revieweeRole: 'CUSTOMER' | 'DRIVER';
  rating: number;
  tags: string[];
  comment?: string | null;
  isPublished: boolean;
  adminFlagged: boolean;
  createdAt: Date;
}): Review {
  return {
    id: String(doc._id),
    bookingId: String(doc.bookingId),
    reviewerId: String(doc.reviewerId),
    reviewerRole: doc.reviewerRole,
    revieweeId: String(doc.revieweeId),
    revieweeRole: doc.revieweeRole,
    rating: doc.rating,
    tags: doc.tags,
    comment: doc.comment ?? null,
    isPublished: doc.isPublished,
    adminFlagged: doc.adminFlagged,
    createdAt: doc.createdAt,
  };
}
