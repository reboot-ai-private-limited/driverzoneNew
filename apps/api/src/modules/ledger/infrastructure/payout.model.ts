import mongoose, { Schema } from 'mongoose';

export interface PayoutDoc {
  _id: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  amountPaise: number;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';
  utr?: string | null;
  notes?: string | null;
  processedAt?: Date | null;
  createdAt: Date;
}

const payoutSchema = new Schema<PayoutDoc>(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true, index: true },
    amountPaise: { type: Number, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'PAID', 'FAILED'],
      default: 'PAID',
      index: true,
    },
    utr: { type: String, default: null },
    notes: { type: String, default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

payoutSchema.index({ createdAt: -1 });
payoutSchema.index({ driverId: 1, createdAt: -1 });

export const PayoutModel =
  (mongoose.models['Payout'] as mongoose.Model<PayoutDoc> | undefined) ??
  mongoose.model<PayoutDoc>('Payout', payoutSchema);
