import type { DocumentType } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import type { DocumentStoragePort } from '../../domain/documentStorage.port.js';
import type {
  DriverDocument,
  DriverDocumentRepositoryPort,
} from '../../domain/driverDocument.repository.port.js';

export interface RequestUploadInput {
  docType: DocumentType;
  number?: string | undefined;
  subType?: string | undefined;
  issuedOn?: Date | undefined;
  expiresOn?: Date | undefined;
}

export interface RequestUploadResult {
  document: DriverDocument;
  uploadUrl: string;
  expiresInSeconds: number;
}

/**
 * APPLICATION — a driver's documents.
 *
 * The row is created BEFORE the file exists, holding the storage key the client is about to
 * upload to. That ordering is what makes the flow recoverable: if the upload fails or the app
 * is killed mid-transfer, the driver sees a `PENDING` document they can re-upload, rather than
 * a silent nothing with no record that they ever tried.
 *
 * The consequence to be honest about: a row can reference an object that was never uploaded.
 * An admin reviewing a document with no file rejects it, which is the correct outcome and needs
 * no extra machinery.
 */
export class ManageDriverDocumentsUseCase {
  constructor(
    private readonly documents: DriverDocumentRepositoryPort,
    private readonly storage: DocumentStoragePort,
  ) {}

  async requestUpload(driverId: string, input: RequestUploadInput): Promise<RequestUploadResult> {
    // An expiry already in the past is a data-entry slip worth catching here rather than at
    // review time, when it costs the driver a round trip through a human.
    if (input.expiresOn !== undefined && input.expiresOn.getTime() < Date.now()) {
      throw AppError.badRequest('That document has already expired.', {
        field: 'expires_on',
      });
    }

    const presigned = await this.storage.presignDriverDocumentUpload(driverId, input.docType);

    // Upsert: one document per type per driver. Re-uploading replaces, and the replacement is
    // PENDING again — inheriting a previous VERIFIED would let a driver swap an approved
    // document for anything at all.
    const document = await this.documents.upsert({
      driverId,
      docType: input.docType,
      fileUrl: presigned.storageKey,
      number: input.number,
      subType: input.subType,
      issuedOn: input.issuedOn,
      expiresOn: input.expiresOn,
    });

    return {
      document,
      uploadUrl: presigned.uploadUrl,
      expiresInSeconds: presigned.expiresInSeconds,
    };
  }

  list(driverId: string): Promise<DriverDocument[]> {
    return this.documents.listByDriver(driverId);
  }
}
