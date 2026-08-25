import mongoose, { Schema } from 'mongoose';
import type { Polygon } from '@driverzone/geo';

/**
 * INFRASTRUCTURE — the `zones` collection (docs/LLD/database-schema.md).
 *
 * `parentZoneId` is retained, always `null` — Z-1 (pickup ⊆ city) was retired 2026-08-25
 * (docs/LLD/zones.md, docs/decision-log.md). Kept rather than deleted because
 * `checkWithinParent` still exists in `@driverzone/geo`, dormant, and a future nested-zone
 * design would switch it back on rather than re-add the field.
 *
 * Only the document-local half of Z-4 is enforceable here (a PICKUP needs a charge type). The
 * geometric invariants (Z-2/Z-3/Z-MIN-AREA/Z-MAX-AREA) need siblings, so they live in
 * `CreateZoneUseCase`/`UpdateZoneGeometryUseCase`, calling `validateZone()` from
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

    // DORMANT — always null. See the file header.
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
zoneSchema.index({ supersededBy: 1 }); // version history
// Partial: superseded versions accumulate and must not block a new version reusing the code.
zoneSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

zoneSchema.pre('validate', function (next) {
  if (this.type === 'PICKUP' && !this.pickupChargeType) {
    return next(new Error('A PICKUP zone requires a charge type'));
  }
  next();
});

export const ZoneModel =
  (mongoose.models['Zone'] as mongoose.Model<ZoneDoc> | undefined) ??
  mongoose.model<ZoneDoc>('Zone', zoneSchema);
