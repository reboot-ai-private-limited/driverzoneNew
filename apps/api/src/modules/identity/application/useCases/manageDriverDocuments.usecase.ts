import type { DocumentType } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import type { StoragePort } from '@/shared/storage/storage.port.js';
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
  /**
   * The provider's required form fields, passed straight through to the client.
   *
   * This has to reach the caller or the upload cannot happen at all. Cloudinary signs
   * `api_key`/`timestamp`/`public_id`/`type` with the API secret, which exists only on this
   * side — a client cannot derive the signature, so dropping the fields here leaves it holding a
   * URL it can only ever get a 401 from. That was the bug; this field is the fix.
   *
   * Optional because the port is provider-agnostic: an S3 presigned URL carries its
   * authorisation in the query string and needs no fields (see `StoragePort.PresignedUpload`).
   */
  uploadFields?: Record<string, string> | undefined;
}

/**
 * APPLICATION — a driver's documents.
 *
 * This doesn't actually receive the file — it mints a short-lived URL for the client to PUT the
 * file into object storage directly, bypassing our bandwidth entirely. It records the document as
 * PENDING with the key it expects the file to land at.
 */
export interface DriverDocumentWithUrl extends DriverDocument {
  url: string;
}

export class ManageDriverDocumentsUseCase {
  constructor(
    private readonly documents: DriverDocumentRepositoryPort,
    private readonly storage: StoragePort,
    private readonly maxSizeBytes: number,
    private readonly allowedFormats: string[]
  ) {}

  async requestUpload(driverId: string, input: RequestUploadInput): Promise<RequestUploadResult> {
    // An expiry already in the past is a data-entry slip worth catching here rather than at
    // review time, when it costs the driver a round trip through a human.
    if (input.expiresOn !== undefined && input.expiresOn.getTime() < Date.now()) {
      throw AppError.badRequest('That document has already expired.', {
        field: 'expires_on',
      });
    }

    const storageKey = `driver-documents/${driverId}/${input.docType}-${Date.now()}`;
    const presigned = await this.storage.presignUpload(storageKey, true, {
      maxSizeBytes: this.maxSizeBytes,
      allowedFormats: this.allowedFormats,
    });

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
      // Spread rather than `uploadFields: presigned.uploadFields`: the app compiles under
      // `exactOptionalPropertyTypes`, which refuses an explicitly-passed `undefined` for an
      // optional property. Omitting the key entirely is the difference between "no fields
      // needed" and a type error.
      ...(presigned.uploadFields === undefined ? {} : { uploadFields: presigned.uploadFields }),
    };
  }

  async list(driverId: string): Promise<DriverDocumentWithUrl[]> {
    const docs = await this.documents.listByDriver(driverId);
    return Promise.all(
      docs.map(async (doc) => {
        const url = await this.storage.presignDownload(doc.fileUrl);
        return {
          ...doc,
          url,
        };
      })
    );
  }
}
