import { v2 as cloudinary } from 'cloudinary';
import type { StoragePort, PresignedUpload } from './storage.port.js';

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * The resource type used when DELIVERING a stored file.
 *
 * `auto` is an UPLOAD-endpoint value only — it asks Cloudinary to detect the kind of file being
 * ingested. There is no `auto` DELIVERY resource type, so `res.cloudinary.com/<cloud>/auto/...`
 * answers HTTP 400 with a placeholder GIF. That is why documents uploaded from the phone looked
 * missing in both the driver app and the admin web: the bytes were in Cloudinary all along, but
 * every URL we handed out was unresolvable.
 *
 * `image` is correct for everything this project uploads — Cloudinary classifies PDFs as `image`
 * as well, so the whole `UPLOAD_ALLOWED_FORMATS` whitelist is covered.
 */
const DELIVERY_RESOURCE_TYPE = 'image' as const;

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
      resource_type: DELIVERY_RESOURCE_TYPE,
    });
  }

  async presignDownload(storageKey: string, expiresInSeconds = 300): Promise<string> {
    // Generates a signed URL that grants temporary access to an authenticated asset.
    return cloudinary.url(storageKey, {
      secure: true,
      sign_url: true,
      type: 'authenticated',
      resource_type: DELIVERY_RESOURCE_TYPE,
      // Honoured only where Cloudinary enforces signed-URL expiry; the signature above is what
      // actually gates access. Kept so the port's contract stays truthful where it is enforced.
      expires_at: Math.round(Date.now() / 1000) + expiresInSeconds,
    });
  }

  async deleteFile(storageKey: string, isPrivate = true): Promise<void> {
    await cloudinary.uploader.destroy(storageKey, {
      // Must match the upload's type — see `presignUpload` — or Cloudinary finds nothing to delete.
      type: isPrivate ? 'authenticated' : 'upload',
      invalidate: true,
    });
  }
}
