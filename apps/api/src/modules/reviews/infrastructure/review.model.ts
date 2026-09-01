import mongoose, { Schema } from 'mongoose';

/**
 * INFRASTRUCTURE — the `reviews` collection (docs/LLD/reviews.md).
 *
 * Stores post-trip ratings and reviews submitted by both customers and drivers.
 * A single booking has at most two reviews: one from the customer, one from the driver.
 */

export interface ReviewDoc {
  _id: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;

  reviewerId: mongoose.Types.ObjectId;
  reviewerRole: 'CUSTOMER' | 'DRIVER';

  revieweeId: mongoose.Types.ObjectId;
  revieweeRole: 'CUSTOMER' | 'DRIVER';

  rating: number;
  tags: string[];
  comment?: string | null;

  /** False until the other party reviews, or the submission window elapses. */
  isPublished: boolean;
  /** Raised automatically on a 1- or 2-star review, and toggled by ops from the admin panel. */
  adminFlagged: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<ReviewDoc>(
  {
    bookingId: { type: Schema.Types.ObjectId, required: true },

    reviewerId: { type: Schema.Types.ObjectId, required: true },
    reviewerRole: { type: String, enum: ['CUSTOMER', 'DRIVER'], required: true },

    revieweeId: { type: Schema.Types.ObjectId, required: true },
    revieweeRole: { type: String, enum: ['CUSTOMER', 'DRIVER'], required: true },

    rating: { type: Number, min: 1, max: 5, required: true },
    tags: { type: [String], default: [] },
    comment: { type: String, maxlength: 500, default: null },

    isPublished: { type: Boolean, default: false },
    adminFlagged: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// A user can only review a specific booking once.
reviewSchema.index({ bookingId: 1, reviewerId: 1 }, { unique: true });

// For computing averages and displaying history for a given user.
reviewSchema.index({ revieweeId: 1, isPublished: 1, createdAt: -1 });

// The sweep's query, which the index above cannot serve: it leads with `revieweeId`, and the
// sweep has no reviewee — it asks for everything still blind past a cutoff, once a minute.
reviewSchema.index({ isPublished: 1, createdAt: 1 });

// For Ops filtering by flagged reviews or low ratings.
reviewSchema.index({ rating: 1 });

export const ReviewModel =
  (mongoose.models['Review'] as mongoose.Model<ReviewDoc> | undefined) ??
  mongoose.model<ReviewDoc>('Review', reviewSchema);
