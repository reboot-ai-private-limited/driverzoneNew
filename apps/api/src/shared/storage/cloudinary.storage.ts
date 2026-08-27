import { v2 as cloudinary } from 'cloudinary';
import type { StoragePort, PresignedUpload } from './storage.port.js';

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export class CloudinaryStorage implements StoragePort {
  constructor(private readonly config: CloudinaryConfig) {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
    });
  }

  async presignUpload(
    storageKey: string,
    isPrivate: boolean,
    options?: { maxSizeBytes?: number; allowedFormats?: string[] },
  ): Promise<PresignedUpload> {
    const timestamp = Math.round(Date.now() / 1000);
    // When isPrivate is true, we set the type to 'authenticated' so the file
    // is not publicly readable by default. Otherwise, it uses the default 'upload' type.
    const type = isPrivate ? 'authenticated' : 'upload';

    // The parameters that MUST be signed. If the client tries to alter these
    // during the upload, Cloudinary will reject the request.
    const paramsToSign: Record<string, string | number> = {
      timestamp,
      public_id: storageKey,
      type,
    };

    if (options?.allowedFormats && options.allowedFormats.length > 0) {
      // Cloudinary expects a comma-separated string for allowed formats.
      paramsToSign['allowed_formats'] = options.allowedFormats.join(',');
    }

    // Note: S3 natively supports file size limits via presigned POST policies (content-length-range).
    // Cloudinary manages file size limits globally via your account plan (e.g., 10MB limit on free tiers)
    // rather than per-upload signatures. The client should enforce maxSizeBytes before uploading.

    const signature = cloudinary.utils.api_sign_request(paramsToSign, this.config.apiSecret);

    // Build the form-data fields the client must send
    const uploadFields: Record<string, string> = {
      api_key: this.config.apiKey,
      timestamp: String(timestamp),
      public_id: storageKey,
      type,
      signature,
    };

    if (options?.allowedFormats && options.allowedFormats.length > 0) {
      uploadFields['allowed_formats'] = options.allowedFormats.join(',');
    }

    return {
      // auto/upload allows Cloudinary to automatically detect the file type (image, video, raw)
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.config.cloudName}/auto/upload`,
      storageKey,
      expiresInSeconds: 300,
      uploadFields,
    };
  }

  getPublicUrl(storageKey: string): string {
    // Generates a permanent, public CDN URL.
    // This will return a 403 Forbidden or Not Found if the asset was uploaded as 'authenticated'.
    return cloudinary.url(storageKey, {
      secure: true,
      resource_type: 'auto',
    });
  }

  async presignDownload(storageKey: string, expiresInSeconds = 300): Promise<string> {
    // Generates a signed URL that grants temporary access to an authenticated asset.
    return cloudinary.url(storageKey, {
      sign_url: true,
      type: 'authenticated',
      // We use auto to ensure it serves the correct resource type if it's not strictly an image.
      resource_type: 'auto',
      expires_at: Math.round(Date.now() / 1000) + expiresInSeconds,
    });
  }

  async deleteFile(storageKey: string): Promise<void> {
    await cloudinary.uploader.destroy(storageKey, {
      // Important to specify the type so Cloudinary can locate authenticated assets too.
      type: 'authenticated',
      invalidate: true,
    });
  }
}
