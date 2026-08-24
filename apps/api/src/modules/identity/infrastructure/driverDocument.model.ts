import mongoose, { Schema } from 'mongoose';
import type { DocumentStatus, DocumentType } from '@driverzone/contracts';

/**
 * INFRASTRUCTURE — the `driverDocuments` collection (docs/LLD/03-database-schema.md).
 *
 * `fileUrl` holds the object's storage KEY, not a fetchable URL. A presigned download link is
 * minted on demand and expires in minutes (docs/LLD/09-architecture.md), so persisting one would
 * store a value that is broken by the time anybody reads it — and briefly publicly fetchable
 * before that, which is worse.
 */

export interface DriverDocumentDoc {
  _id: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  docType: DocumentType;
  status: DocumentStatus;
  rejectionReason?: string | null;
  fileUrl: string;
  number?: string | null;
  subType?: string | null;
  issuedOn?: Date | null;
  expiresOn?: Date | null;
  verifiedAt?: Date | null;
  verifiedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const driverDocumentSchema = new Schema<DriverDocumentDoc>(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    docType: {
      type: String,
      required: true,
      enum: ['LICENCE', 'AADHAAR', 'POLICE_VERIFICATION', 'VEHICLE_RC', 'INSURANCE'],
    },
    status: { type: String, default: 'PENDING', enum: ['PENDING', 'VERIFIED', 'REJECTED'] },

    // Why a rejected document says why: a driver told only "rejected" has nothing to act on and
    // re-uploads the same unreadable photo.
    rejectionReason: { type: String, default: null },

    fileUrl: { type: String, required: true },
    number: { type: String, default: null },
    subType: { type: String, default: null },   // licence category, e.g. LMV / LMV-TR
    issuedOn: { type: Date, default: null },
    expiresOn: { type: Date, default: null },

    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  },
  { timestamps: true },
);

// One document per type per driver — re-uploading replaces rather than accumulating a pile an
// admin has to sift through to find the current one.
driverDocumentSchema.index({ driverId: 1, docType: 1 }, { unique: true });

// The expiry-warning job (docs/LLD/10-admin-panel.md: "documents expiring within 7 days").
driverDocumentSchema.index({ expiresOn: 1 });

export const DriverDocumentModel =
  (mongoose.models['DriverDocument'] as mongoose.Model<DriverDocumentDoc> | undefined) ??
  mongoose.model<DriverDocumentDoc>('DriverDocument', driverDocumentSchema);
