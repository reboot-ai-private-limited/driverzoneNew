import type { DocumentSide, DocumentStatus, DocumentType } from '@driverzone/contracts';

/** PORT — a driver's uploaded identity documents. */

export interface DriverDocument {
  id: string;
  driverId: string;
  docType: DocumentType;
  /** Which face this file is. A two-sided document is two of these rows. */
  side: DocumentSide;
  status: DocumentStatus;
  rejectionReason: string | null;
  fileUrl: string;
  number: string | null;
  subType: string | null;
  issuedOn: Date | null;
  expiresOn: Date | null;
}

export interface UpsertDocumentInput {
  driverId: string;
  docType: DocumentType;
  side: DocumentSide;
  fileUrl: string;
  number?: string | undefined;
  subType?: string | undefined;
  issuedOn?: Date | undefined;
  expiresOn?: Date | undefined;
}

export interface DriverDocumentRepositoryPort {
  listByDriver(driverId: string): Promise<DriverDocument[]>;

  findById(documentId: string): Promise<DriverDocument | undefined>;

  /**
   * One document per type per SIDE per driver — an upsert, not an insert.
   *
   * Matches the unique `(driverId, docType, side)` index. Re-uploading the back of a licence
   * replaces that back and leaves the front alone, rather than accumulating a pile an admin has to
   * sift through — or, worse, silently overwriting the other face.
   *
   * It also resets status to `PENDING` for that side: a replaced file has not been verified, and
   * inheriting the old `VERIFIED` would let a driver swap an approved document for anything at
   * all. The other side keeps whatever decision it already had, which is the point of per-side
   * review.
   */
  upsert(input: UpsertDocumentInput): Promise<DriverDocument>;

  review(
    documentId: string,
    status: DocumentStatus,
    rejectionReason: string | null,
    adminId: string,
    at: Date,
  ): Promise<DriverDocument | undefined>;
}
