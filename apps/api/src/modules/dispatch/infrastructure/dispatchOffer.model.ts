import mongoose, { Schema } from 'mongoose';
import { DELIVERY_CHANNELS } from '@driverzone/contracts';
import { DISPATCH_ATTEMPTS, MANUAL_ASSIGNMENT_WAVE, OFFER_STATUSES } from '../domain/offer.entity.js';

export interface DispatchOfferDoc {
  _id: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  wave: number;
  attempt: string;
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
    /*
     * `min: 0`, NOT 1. Wave 0 is the favourite-driver wave — the customer's own drivers, rung
     * before the radius ladder starts. Numbering it zero rather than shifting every other wave up
     * is what lets it reuse the whole machinery unchanged: `lapseWave`, the timeout job id, the
     * `driverIdsOffered` exclusion, and `ExpireWaveUseCase`'s `wave + 1`, which lands exactly on
     * the ordinary first wave.
     */
    wave: { type: Number, required: true, min: MANUAL_ASSIGNMENT_WAVE },

    /*
     * `default: 'FINAL'` is what makes this safe to deploy over existing data: every offer row
     * written before the early ring existed was, by definition, part of the only search that
     * booking ever got. Reading one back as `FINAL` is not a guess, it is the truth.
     */
    attempt: { type: String, enum: DISPATCH_ATTEMPTS, required: true, default: 'FINAL' },
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

/**
 * One offer per driver per booking PER ATTEMPT — a later wave must never ring someone twice.
 *
 * The third column is the early ring. Within one search the rule is unchanged: waves widen, and a
 * driver who ignored wave 1 is not rung again at wave 2. Across the two searches of a scheduled
 * booking it must not hold — the early ring asks at 9 pm, the final ring asks at 4:30 am, and
 * those are different questions to the same person about a day they now know something about.
 *
 * **This index changes shape on an existing collection.** The old two-column unique index has to
 * be dropped for this one to take effect; Mongoose will not replace it in place, and until it is
 * dropped the final ring will still fail with a duplicate key on any driver the early ring
 * already offered to.
 */
dispatchOfferSchema.index({ bookingId: 1, driverId: 1, attempt: 1 }, { unique: true });

dispatchOfferSchema.index({ bookingId: 1, wave: 1, status: 1 });

/** The recovery path: "what is ringing on my phone right now". Partial, so it stays tiny. */
dispatchOfferSchema.index(
  { driverId: 1, expiresAt: 1 },
  { partialFilterExpression: { status: 'SENT' } },
);

export const DispatchOfferModel =
  (mongoose.models['DispatchOffer'] as mongoose.Model<DispatchOfferDoc> | undefined) ??
  mongoose.model<DispatchOfferDoc>('DispatchOffer', dispatchOfferSchema);
