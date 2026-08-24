import { randomUUID } from 'node:crypto';
import type { DocumentType } from '@driverzone/contracts';
import { isProduction } from '@/config/env.js';
import { logger } from '@/shared/logging/logger.js';
import { AppError } from '@/shared/errors/AppError.js';
import type { DocumentStoragePort, PresignedUpload } from '../domain/documentStorage.port.js';

/**
 * INFRASTRUCTURE — a stand-in for object storage, for development only.
 *
 * There is no S3-compatible bucket in this project yet (`09-architecture.md` specifies one; no
 * code or compose service provides it). This adapter mints a plausible-looking key and a URL
 * that accepts nothing, so the whole driver-onboarding flow — upload request, document row,
 * submission gate, admin review — is exercisable end to end today.
 *
 * **It refuses to run in production**, for the same reason `otpSender.log.ts` does: a deploy
 * that silently accepted document uploads into nowhere would look like it worked, and the
 * failure would surface weeks later as an admin opening a driver's licence and finding nothing
 * there. Failing at startup-of-use makes that a five-minute diagnosis.
 *
 * Replacing it is one line in `identity.container.ts`. The port is what the use case depends on;
 * nothing above this file knows which implementation is in play.
 */
export class StubDocumentStorage implements DocumentStoragePort {
  presignDriverDocumentUpload(driverId: string, docType: DocumentType): Promise<PresignedUpload> {
    if (isProduction) {
      return Promise.reject(
        AppError.internal('INTERNAL', {
          reason: 'StubDocumentStorage must never run in production — no object storage is configured',
        }),
      );
    }

    /**
     * The key shape mirrors what the real adapter should use: driver-scoped prefix, document
     * type, and a random suffix.
     *
     * The suffix matters even though `(driverId, docType)` is unique in Mongo — a re-upload must
     * land on a NEW object rather than overwriting the old one in place, so that a verified
     * document's bytes cannot be swapped out from under an approval that already happened.
     */
    const storageKey = `drivers/${driverId}/${docType.toLowerCase()}/${randomUUID()}`;

    logger.warn(
      { driverId, docType, storageKey },
      'DEV ONLY — no object storage configured, upload URL is not functional',
    );

    return Promise.resolve({
      // Deliberately not a real endpoint. A client PUTting here fails loudly rather than
      // believing an upload succeeded.
      uploadUrl: `https://storage.invalid/dev-upload/${storageKey}`,
      storageKey,
      expiresInSeconds: 300,
    });
  }
}
