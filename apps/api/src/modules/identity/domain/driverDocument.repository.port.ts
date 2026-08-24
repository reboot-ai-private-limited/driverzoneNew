import type { DocumentStatus, DocumentType } from '@driverzone/contracts';

/** PORT — a driver's uploaded identity and vehicle documents. */

export interface DriverDocument {
  id: string;
  driverId: string;
  docType: DocumentType;
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
   * One document per type per driver — an upsert, not an insert.
   *
   * Matches the unique `(driverId, docType)` index in docs/LLD/database-schema.md. Re-uploading
   * a licence replaces the old row rather than accumulating a pile an admin has to sift through
   * to find the current one. It also resets status to `PENDING`: a replaced file has not been
   * verified, and inheriting the old `VERIFIED` would let a driver swap an approved document for
   * anything at all.
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
