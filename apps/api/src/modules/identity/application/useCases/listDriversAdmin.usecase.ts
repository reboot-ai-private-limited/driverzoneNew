import type {
  DriverProfileRepositoryPort,
  DriverListFilter,
  DriverProfile,
} from '../../domain/driverProfile.repository.port.js';
import type { DriverDocumentRepositoryPort } from '../../domain/driverDocument.repository.port.js';
import type { StoragePort } from '@/shared/storage/storage.port.js';

export interface AdminDriverListItem {
  profile: DriverProfile;
  dlExpiry: Date | null;
  dlNumber: string | null;
  profilePictureUrl: string | null;
  rating: number | null;
  totalTrips: number;
  lastRideAt: Date | null;
}

export interface ListDriversAdminResult {
  drivers: AdminDriverListItem[];
  totalItems: number;
}

export class ListDriversAdminUseCase {
  constructor(
    private readonly drivers: DriverProfileRepositoryPort,
    private readonly documents: DriverDocumentRepositoryPort,
    private readonly storage?: StoragePort
  ) {}

  async execute(
    filter: DriverListFilter,
    page: number,
    limit: number
  ): Promise<ListDriversAdminResult> {
    const { drivers, totalItems } = await this.drivers.findPaginated(filter, page, limit);

    // Fetch all documents for these drivers in parallel to find their LICENCE expiry and number
    const withDocs = await Promise.all(
      drivers.map(async (profile) => {
        const docs = await this.documents.listByDriver(profile.id);
        const licence = docs.find(d => d.docType === 'LICENCE');
        const profilePictureUrl = profile.profilePicture
          ? (this.storage ? this.storage.getPublicUrl(profile.profilePicture) : profile.profilePicture)
          : null;
        return {
          profile,
          dlExpiry: licence?.expiresOn ?? null,
          dlNumber: licence?.number ?? null,
          profilePictureUrl,
          rating: profile.rating ?? 5.0,
          totalTrips: profile.totalTrips ?? profile.ratingCount ?? 0,
          lastRideAt: profile.lastRideAt ?? null,
        };
      })
    );

    return { drivers: withDocs, totalItems };
  }
}

