import { Schema, model } from 'mongoose';

/**
 * The variant carries its own price. There was a `prices[]` sub-schema here, one row per car
 * category — retired 2026-08-28 (docs/decision-log.md) along with pricing by category.
 */
const incityVariantSchema = new Schema(
  {
    label: { type: String, required: true },
    // What the customer buys. There is no overage: `extraMinuteRatePaise`, `extraKmRatePaise`
    // and the `includedKm` cap were removed 2026-08-28, along with `enforceDropInCity` and
    // `sortOrder` (docs/decision-log.md).
    includedMinutes: { type: Number, required: true, min: 1 },

    baseFarePaise: { type: Number, required: true, min: 0 },

    // What the driver is paid, in paise — a flat amount, not a share (2026-09-10). The company
    // keeps the remainder. No upper bound here: the ceiling is the variant's own fare, which
    // this schema cannot see, so `packages.validation.ts` enforces it with both numbers in hand.
    driverAmountPaise: { type: Number, required: true, min: 0 },

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
