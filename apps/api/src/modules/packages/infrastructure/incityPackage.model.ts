import { Schema, model } from 'mongoose';

const incityPriceSchema = new Schema(
  {
    carCategoryId: { type: Schema.Types.ObjectId, ref: 'CarCategory', required: true },
    baseFarePaise: { type: Number, required: true, min: 0 },
    extraMinuteRatePaise: { type: Number, default: 0, min: 0 },
    extraKmRatePaise: { type: Number, default: 0, min: 0 },

    driverCommissionType: { type: String, enum: ['PERCENT', 'FLAT'], required: true },
    driverCommissionValue: { type: Number, required: true },
    companyCommissionType: { type: String, enum: ['PERCENT', 'FLAT'], required: true },
    companyCommissionValue: { type: Number, required: true },

    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

const incityVariantSchema = new Schema(
  {
    label: { type: String, required: true },
    includedMinutes: { type: Number, required: true, min: 1 },
    includedKm: { type: Number, required: true, min: 0 },

    enforceDropInCity: { type: Boolean, default: true },

    prices: [incityPriceSchema],
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

const incityPackageSchema = new Schema(
  {
    /**
     * The ONLY zone reference a package carries. Pickup zones gate serviceability and carry a
     * fee, and have finished their whole job before package matching begins — `pickupZoneIds`
     * was deleted here with invariant P-1 (docs/decision-log.md, 2026-08-25).
     */
    cityZoneId: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },
    name: { type: String, required: true },
    description: String,
    variants: [incityVariantSchema],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

incityPackageSchema.index({ cityZoneId: 1, isActive: 1 });

export const IncityPackageModel = model('IncityPackage', incityPackageSchema);
