import type { DocumentType } from '@driverzone/contracts';

/**
 * PORT — somewhere to put a file, without naming the provider.
 *
 * `09-architecture.md` specifies an S3-compatible private bucket with 5-minute presigned URLs.
 * None exists yet, so `documentStorage.stub.ts` stands in for local development; the real
 * adapter is a one-line change in `identity.container.ts`.
 *
 * The port hands back BOTH a URL to upload to and the key to store, because they are different
 * things with different lifetimes: the upload URL expires in minutes, while the key is what the
 * row keeps forever and what a later download URL is minted from.
 *
 * This lives in the module's `domain/` rather than `shared/` for now, following the repo's
 * ports-live-in-domain rule. It moves to `shared/storage/` when `bookings` needs receipt URLs —
 * `09-architecture.md` names both as consumers.
 */
export interface PresignedUpload {
  /** Where the client `PUT`s the file. Short-lived. Never stored. */
  uploadUrl: string;
  /** The object's permanent identity in the bucket. This is what the document row keeps. */
  storageKey: string;
  expiresInSeconds: number;
}

export interface DocumentStoragePort {
  /**
   * Mints an upload URL for one driver document.
   *
   * The file never passes through this API — the client uploads directly. That keeps large
   * multipart bodies off the request path entirely, which matters on a driver's mobile
   * connection and keeps document bytes out of the API's memory and logs.
   */
  presignDriverDocumentUpload(driverId: string, docType: DocumentType): Promise<PresignedUpload>;
}
