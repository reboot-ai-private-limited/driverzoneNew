import { AppError } from '@/shared/errors/AppError.js';
import type { StoragePort } from '@/shared/storage/storage.port.js';
import type {
  DriverProfile,
  DriverProfileRepositoryPort,
} from '../../domain/driverProfile.repository.port.js';
import type {
  DriverDocument,
  DriverDocumentRepositoryPort,
} from '../../domain/driverDocument.repository.port.js';

export interface DriverDocumentWithUrl extends DriverDocument {
  url: string;
}

export interface DriverDetailsResult {
  profile: DriverProfile & { profilePictureUrl: string | null };
  documents: DriverDocumentWithUrl[];
}

export class GetDriverDetailsAdminUseCase {
  constructor(
    private readonly drivers: DriverProfileRepositoryPort,
    private readonly documents: DriverDocumentRepositoryPort,
    private readonly storage: StoragePort
  ) {}

  async execute(driverId: string): Promise<DriverDetailsResult> {
    const profile = await this.drivers.findById(driverId);
    if (profile === undefined) {
      throw AppError.notFound('That driver could not be found.');
    }

    const profilePictureUrl = profile.profilePicture
      ? this.storage.getPublicUrl(profile.profilePicture)
      : null;

    const docs = await this.documents.listByDriver(driverId);

    // docs.fileUrl is the storage key. The documents are private.
    const documentsWithUrls = await Promise.all(
      docs.map(async (doc) => {
        const url = await this.storage.presignDownload(doc.fileUrl);
        return {
          ...doc,
          url,
        };
      })
    );

    return {
      profile: { ...profile, profilePictureUrl },
      documents: documentsWithUrls
    };
  }
}
