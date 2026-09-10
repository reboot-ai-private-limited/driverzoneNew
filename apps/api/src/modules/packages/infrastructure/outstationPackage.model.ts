import { Schema, model } from 'mongoose';

/**
 * The band IS the price. There was a `prices[]` sub-schema here keyed by
 * `(carCategory, direction)` — ten rows per band — retired 2026-08-28
 * (docs/decision-log.md). Two fares and a flat per-day driver amount remain.
 */
const outstationPackageSchema = new Schema(
  {
    name: { type: String, required: true },
    terrain: { type: String, enum: ['PLAIN', 'HILL'], required: true },
    minKm: { type: Number, required: true, min: 0 },
    maxKm: { type: Number, required: true },

    oneWayFarePaise: { type: Number, required: true, min: 0 },
    // `null` means a same-day return is not offered on this band. `default: null` rather than
    // `default: 0`, because a missing fare and a free trip must not look the same.
    roundTripFarePaise: { type: Number, default: null, min: 0 },

    // What the driver is paid, in paise — a flat amount, not a share (2026-09-10). The company
    // keeps the remainder. No upper bound here: the ceiling is the package own fare, which this
    // schema cannot see, so  enforces it where both numbers are in hand.
    driverAmountPaise: { type: Number, required: true, min: 0 },

    // An outstation package references no zone at all — it is sold against terrain and a
    // distance band. `pickupZoneIds` went with invariant P-1 (docs/decision-log.md, 2026-08-25).
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

outstationPackageSchema.index({ terrain: 1, minKm: 1, maxKm: 1, isActive: 1 });

export const OutstationPackageModel = model('OutstationPackage', outstationPackageSchema);
