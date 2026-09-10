import mongoose, { Schema } from 'mongoose';

/**
 * INFRASTRUCTURE — the `faqs` collection.
 *
 * Unlike `globalSettings`, this collection IS the content: there are no defaults in code to fall
 * back on, so an empty collection means the apps show an empty FAQ screen. That is the correct
 * behaviour on a fresh install — better a screen that says there is nothing yet than placeholder
 * text that reads as real answers.
 *
 * `sortOrder` is stored rather than relying on insertion order, because the order is editorial
 * and changes without the content changing. It is dense from 0 and rewritten on every save; see
 * `orderedForWrite` in `domain/faq.entity.ts` for why the client never supplies it.
 */

export interface FaqDoc {
  _id: mongoose.Types.ObjectId;
  question: string;
  answer: string;
  sortOrder: number;
  isPublished: boolean;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const faqSchema = new Schema<FaqDoc>(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    sortOrder: { type: Number, required: true },
    /*
     * Drafts are the DEFAULT. A row created by anything other than the admin panel — a script, a
     * hand-written insert — stays invisible to customers until somebody publishes it deliberately.
     */
    isPublished: { type: Boolean, required: true, default: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  },
  { timestamps: true },
);

/**
 * The read every app makes: published entries in order. Compound rather than an index on
 * `sortOrder` alone so the filter and the sort are one index scan.
 */
faqSchema.index({ isPublished: 1, sortOrder: 1 });

export const FaqModel =
  (mongoose.models['Faq'] as mongoose.Model<FaqDoc> | undefined) ??
  mongoose.model<FaqDoc>('Faq', faqSchema);
