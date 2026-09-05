import mongoose, { Schema } from 'mongoose';
import {
  DOCUMENT_SIDES,
  DOCUMENT_TYPES,
  type DocumentSide,
  type DocumentStatus,
  type DocumentType,
} from '@driverzone/contracts';

/**
 * INFRASTRUCTURE — the `driverDocuments` collection (docs/LLD/database-schema.md).
 *
 * `fileUrl` holds the object's storage KEY, not a fetchable URL. A presigned download link is
 * minted on demand and expires in minutes (docs/LLD/architecture.md), so persisting one would
 * store a value that is broken by the time anybody reads it — and briefly publicly fetchable
 * before that, which is worse.
 */

export interface DriverDocumentDoc {
  _id: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  docType: DocumentType;
  side: DocumentSide;
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
    // Read from the contract rather than restated: a type added there and forgotten here would
    // fail as a Mongoose validation error at upload time, which is a long way from its cause.
    docType: { type: String, required: true, enum: DOCUMENT_TYPES },
    /**
     * Which face this file is.
     *
     * Defaulted to `FRONT`, which is also the migration: every row written before sides existed
     * was the one and only file for its type, and reading it as the front is what it always was.
     */
    side: { type: String, required: true, default: 'FRONT', enum: DOCUMENT_SIDES },
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

/**
 * One document per type per SIDE per driver — re-uploading replaces rather than accumulating a
 * pile an admin has to sift through to find the current one.
 *
 * `side` joined this key on 2026-09-04, when a licence became a front and a back. The old
 * two-field index must be dropped for this one to be created — Mongo will not build a second
 * unique index over a superset while the first still forbids the second row:
 *
 *   db.driverdocuments.dropIndex('driverId_1_docType_1')
 *
 * Existing rows need no data migration: `side` defaults to `FRONT`, which is what a
 * pre-two-sided row always was.
 */
driverDocumentSchema.index({ driverId: 1, docType: 1, side: 1 }, { unique: true });

// The expiry-warning job (docs/LLD/admin-panel.md: "documents expiring within 7 days").
driverDocumentSchema.index({ expiresOn: 1 });

export const DriverDocumentModel =
  (mongoose.models['DriverDocument'] as mongoose.Model<DriverDocumentDoc> | undefined) ??
  mongoose.model<DriverDocumentDoc>('DriverDocument', driverDocumentSchema);
