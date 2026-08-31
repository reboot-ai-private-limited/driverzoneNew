import mongoose, { Schema } from 'mongoose';
import { DELIVERY_CHANNELS } from '@driverzone/contracts';
import { OFFER_STATUSES } from '../domain/offer.entity.js';

export interface DispatchOfferDoc {
  _id: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  wave: number;
  status: string;
  score: number;
  distanceMetres: number;
  expiresAt: Date;
  deliveredVia: string;
  deliveredAt?: Date | null;
  respondedAt?: Date | null;
  createdAt: Date;
}

const dispatchOfferSchema = new Schema<DispatchOfferDoc>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    wave: { type: Number, required: true, min: 1 },
    status: { type: String, enum: OFFER_STATUSES, required: true, default: 'SENT' },
    score: { type: Number, required: true },
    distanceMetres: { type: Number, required: true },
    expiresAt: { type: Date, required: true },

    /*
     * HOW IT ACTUALLY REACHED THEM, and the operationally important value is `NONE`.
     *
     * An offer that lapsed but was never delivered is OUR infrastructure failing, not a driver
     * ignoring work — and without this column that distinction is unrecoverable after the fact.
     * It is what stops a bad push day quietly destroying a whole city's acceptance rates.
     */
    deliveredVia: { type: String, enum: DELIVERY_CHANNELS, required: true, default: 'NONE' },
    deliveredAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** One offer per driver per booking — a later wave must never ring someone twice. */
dispatchOfferSchema.index({ bookingId: 1, driverId: 1 }, { unique: true });

dispatchOfferSchema.index({ bookingId: 1, wave: 1, status: 1 });

/** The recovery path: "what is ringing on my phone right now". Partial, so it stays tiny. */
dispatchOfferSchema.index(
  { driverId: 1, expiresAt: 1 },
  { partialFilterExpression: { status: 'SENT' } },
);

export const DispatchOfferModel =
  (mongoose.models['DispatchOffer'] as mongoose.Model<DispatchOfferDoc> | undefined) ??
  mongoose.model<DispatchOfferDoc>('DispatchOffer', dispatchOfferSchema);
