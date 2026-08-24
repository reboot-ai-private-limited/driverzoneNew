import mongoose, { Schema } from 'mongoose';
import type { Polygon } from '@driverzone/geo';

/**
 * INFRASTRUCTURE — the `zones` collection (docs/LLD/database-schema.md).
 *
 * Only Z-4 (a document-local check: PICKUP requires a parent+charge type, CITY/HILL must not
 * have a parent) is enforceable here. Z-1/Z-2/Z-3/Z-MIN-AREA need siblings or a parent document,
 * so they live in `CreateZoneUseCase`/`UpdateZoneGeometryUseCase`, calling `validateZone()` from
 * `@driverzone/geo`.
 */

export interface ZoneDoc {
  _id: mongoose.Types.ObjectId;
  type: 'CITY' | 'PICKUP' | 'HILL';
  name: string;
  code: string;
  parentZoneId?: mongoose.Types.ObjectId | null;
  geometry: Polygon;
  priority: number;
  pickupChargeType?: 'FREE' | 'PAID' | null;
  pickupChargePaise?: number | null;
  version: number;
  supersededBy?: mongoose.Types.ObjectId | null;
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const zoneSchema = new Schema<ZoneDoc>(
  {
    type: { type: String, required: true, enum: ['CITY', 'PICKUP', 'HILL'] },
    name: { type: String, required: true },
    code: { type: String, required: true }, // 'SLG', 'SLG-CENTRAL'

    parentZoneId: { type: Schema.Types.ObjectId, ref: 'Zone', default: null },

    geometry: {
      type: { type: String, enum: ['Polygon'], required: true },
      coordinates: { type: [[[Number]]], required: true }, // [ring][point][lng,lat]
    },

    // Defensive tiebreak only — see `resolveZonesAtPoint.usecase.ts`. Should never decide anything.
    priority: { type: Number, default: 0 },

    // PICKUP only.
    pickupChargeType: { type: String, enum: ['FREE', 'PAID', null], default: null },
    pickupChargePaise: { type: Number, default: null }, // null → global default

    version: { type: Number, default: 1 },
    supersededBy: { type: Schema.Types.ObjectId, ref: 'Zone', default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true },
  },
  { timestamps: true },
);

// THE index the whole product depends on — without it, zone resolution is a collection scan on
// every quote request (docs/prd.md's p99 < 50ms target).
zoneSchema.index({ geometry: '2dsphere' });
zoneSchema.index({ type: 1, isActive: 1 });
zoneSchema.index({ parentZoneId: 1, isActive: 1 });
// Partial: superseded versions accumulate and must not block a new version reusing the code.
zoneSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

zoneSchema.pre('validate', function (next) {
  if (this.type === 'PICKUP') {
    if (!this.parentZoneId) return next(new Error('A PICKUP zone requires a parent CITY zone'));
    if (!this.pickupChargeType) return next(new Error('A PICKUP zone requires a charge type'));
  } else if (this.parentZoneId) {
    return next(new Error(`A ${this.type} zone must not have a parent`));
  }
  next();
});

export const ZoneModel =
  (mongoose.models['Zone'] as mongoose.Model<ZoneDoc> | undefined) ??
  mongoose.model<ZoneDoc>('Zone', zoneSchema);
