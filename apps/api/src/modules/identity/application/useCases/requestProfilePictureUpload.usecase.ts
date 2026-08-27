import type { StoragePort, PresignedUpload } from '@/shared/storage/storage.port.js';

export class RequestProfilePictureUploadUseCase {
  constructor(private readonly storage: StoragePort, private readonly maxSizeBytes: number, private readonly allowedFormats: string[]) {}

  async execute(driverId: string): Promise<PresignedUpload> {
    const storageKey = `profile-pictures/driver-${driverId}-${Date.now()}`;
    return this.storage.presignUpload(storageKey, false, {
      maxSizeBytes: this.maxSizeBytes,
      allowedFormats: this.allowedFormats,
    });
  }
}
