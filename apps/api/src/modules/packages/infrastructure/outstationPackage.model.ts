import { Schema, model } from 'mongoose';

const outstationPriceSchema = new Schema(
  {
    carCategoryId: { type: Schema.Types.ObjectId, ref: 'CarCategory', required: true },
    direction: { type: String, enum: ['ONE_WAY', 'ROUND_TRIP'], required: true },
    baseFarePaise: { type: Number, required: true, min: 0 },
    extraKmRatePaise: { type: Number, default: 0, min: 0 },
    driverAllowancePaise: { type: Number, default: 0, min: 0 },

    driverCommissionType: { type: String, enum: ['PERCENT', 'FLAT'], required: true },
    driverCommissionValue: { type: Number, required: true },
    companyCommissionType: { type: String, enum: ['PERCENT', 'FLAT'], required: true },
    companyCommissionValue: { type: Number, required: true },

    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

const outstationPackageSchema = new Schema(
  {
    name: { type: String, required: true },
    terrain: { type: String, enum: ['PLAIN', 'HILL'], required: true },
    minKm: { type: Number, required: true, min: 0 },
    maxKm: { type: Number, required: true },
    pickupZoneIds: [{ type: Schema.Types.ObjectId, ref: 'Zone' }],
    prices: [outstationPriceSchema],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

outstationPackageSchema.index({ terrain: 1, minKm: 1, maxKm: 1, isActive: 1 });

export const OutstationPackageModel = model('OutstationPackage', outstationPackageSchema);
