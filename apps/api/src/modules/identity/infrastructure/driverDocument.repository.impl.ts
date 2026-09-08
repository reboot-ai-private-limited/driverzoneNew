import mongoose from 'mongoose';
import type { DocumentSide, DocumentStatus, DocumentType } from '@driverzone/contracts';
import type {
  DriverDocument,
  DriverDocumentRepositoryPort,
  UpsertDocumentInput,
} from '../domain/driverDocument.repository.port.js';
import { DriverDocumentModel } from './driverDocument.model.js';

interface RawDocument {
  _id: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  docType: string;
  side?: string | null;
  status: string;
  rejectionReason?: string | null;
  fileUrl: string;
  number?: string | null;
  subType?: string | null;
  issuedOn?: Date | null;
  expiresOn?: Date | null;
}

function toDomain(doc: RawDocument): DriverDocument {
  return {
    id: String(doc._id),
    driverId: String(doc.driverId),
    docType: doc.docType as DocumentType,
    // A row written before sides existed has no `side` at all. It was the one file for its type,
    // which is the front — the same reading the schema default encodes for new writes.
    side: (doc.side ?? 'FRONT') as DocumentSide,
    status: doc.status as DocumentStatus,
    rejectionReason: doc.rejectionReason ?? null,
    fileUrl: doc.fileUrl,
    number: doc.number ?? null,
    subType: doc.subType ?? null,
    issuedOn: doc.issuedOn ?? null,
    expiresOn: doc.expiresOn ?? null,
  };
}

export class MongoDriverDocumentRepository implements DriverDocumentRepositoryPort {
  async listByDriver(driverId: string): Promise<DriverDocument[]> {
    if (!mongoose.Types.ObjectId.isValid(driverId)) return [];
    const docs = await DriverDocumentModel.find({ driverId }).lean().exec();
    return (docs as unknown as RawDocument[]).map(toDomain);
  }

  async findById(documentId: string): Promise<DriverDocument | undefined> {
    if (!mongoose.Types.ObjectId.isValid(documentId)) return undefined;
    const doc = await DriverDocumentModel.findById(documentId).lean().exec();
    return doc === null ? undefined : toDomain(doc as unknown as RawDocument);
  }

  /**
   * Upsert on `(driverId, docType, side)`, matching the unique index.
   *
   * Note what is reset rather than preserved: `status` returns to `PENDING` and both review
   * fields are cleared — for THIS SIDE only. A replaced file has not been verified, and inheriting
   * the previous `VERIFIED` would let a driver upload an approved licence and then swap the object
   * behind it for anything at all. Re-photographing the back leaves the front's decision standing,
   * which is what per-side review is for.
   */
  async upsert(input: UpsertDocumentInput): Promise<DriverDocument> {
    const doc = await DriverDocumentModel.findOneAndUpdate(
      {
        driverId: new mongoose.Types.ObjectId(input.driverId),
        docType: input.docType,
        side: input.side,
      },
      {
        $set: {
          fileUrl: input.fileUrl,
          status: 'PENDING',
          rejectionReason: null,
          verifiedAt: null,
          verifiedBy: null,
          number: input.number ?? null,
          subType: input.subType ?? null,
          issuedOn: input.issuedOn ?? null,
          expiresOn: input.expiresOn ?? null,
        },
      },
      { new: true, upsert: true },
    )
      .lean()
      .exec();

    return toDomain(doc as unknown as RawDocument);
  }

  async review(
    documentId: string,
    status: DocumentStatus,
    rejectionReason: string | null,
    adminId: string,
    at: Date,
  ): Promise<DriverDocument | undefined> {
    if (!mongoose.Types.ObjectId.isValid(documentId)) return undefined;

    const doc = await DriverDocumentModel.findByIdAndUpdate(
      documentId,
      {
        $set: {
          status,
          rejectionReason,
          // Stamped on any review decision, not just approval: "who looked at this and when" is
          // the question, and a rejection is equally an admin having looked.
          verifiedBy: new mongoose.Types.ObjectId(adminId),
          verifiedAt: at,
        },
      },
      { new: true },
    )
      .lean()
      .exec();

    return doc === null ? undefined : toDomain(doc as unknown as RawDocument);
  }
}
