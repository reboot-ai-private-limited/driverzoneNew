import type { Request, RequestHandler } from 'express';
import type {
  DriverDocumentDto,
  DriverProfileDto,
  RequestDocumentUploadResponse,
  RequestProfilePictureUploadResponse,
  SubmitOnboardingResponse,
  DutyStateDto,
  LocationPingsAcceptedDto,
  RegisterDeviceResponse,
} from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { DriverProfile } from '../domain/driverProfile.repository.port.js';
import type { GetDriverProfileUseCase } from '../application/useCases/getDriverProfile.usecase.js';
import type { UpdateDriverProfileUseCase } from '../application/useCases/updateDriverProfile.usecase.js';
import type { ManageDriverDocumentsUseCase, DriverDocumentWithUrl } from '../application/useCases/manageDriverDocuments.usecase.js';
import type { SubmitOnboardingUseCase } from '../application/useCases/submitOnboarding.usecase.js';
import type { SetDutyStatusUseCase } from '../application/useCases/setDutyStatus.usecase.js';
import type { RecordLocationPingsUseCase } from '../application/useCases/recordLocationPings.usecase.js';
import type { DriverDeviceRepositoryPort } from '../domain/driverDevice.repository.port.js';
import type { RequestProfilePictureUploadUseCase } from '../application/useCases/requestProfilePictureUpload.usecase.js';
import {
  requestDocumentUploadSchema,
  registerDeviceSchema,
  sendLocationPingsSchema,
  setDutyStatusSchema,
  updateDriverProfileSchema,
} from './identity.validation.js';

/** INTERFACE — the driver's own profile, documents and onboarding submission. */

function toDateOnly(d: Date | null): string | null {
  return d === null ? null : (d.toISOString().split('T')[0] ?? null);
}

function fromDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function subjectId(req: Request): string {
  const id = req.principal?.sub;
  if (id === undefined) throw AppError.unauthenticated();
  return id;
}

function profileToDto(p: DriverProfile): DriverProfileDto {
  return {
    id: p.id,
    mobile_number: p.mobileNumber,
    full_name: p.fullName,
    profile_picture: p.profilePicture,
    dob: toDateOnly(p.dob),
    gender: p.gender,
    experience_years: p.experienceYears,
    alternate_number: p.alternatePhone,
    emergency_contact:
      p.emergencyContact === null
        ? null
        : { name: p.emergencyContact.name, number: p.emergencyContact.phone },
    address: p.address,
    vehicle_type_preferences: p.vehicleTypePreferences,
    vehicle_category_preference: p.vehicleCategoryPreference,
    can_drive_hill: p.canDriveHill,
    can_drive_hill_verified: p.canDriveHillVerified,
    onboarding_status: p.onboardingStatus,
    onboarding_rejection_reason: p.onboardingRejectionReason,
    is_verified: p.isVerified,
    is_on_duty: p.isOnDuty,
  };
}

/**
 * `fileUrl` holds an object storage KEY, which is an internal detail; a download link is minted on
 * demand and expires in minutes. We resolve it to `url` before sending to the client.
 */
function documentToDto(d: DriverDocumentWithUrl): DriverDocumentDto {
  return {
    id: d.id,
    doc_type: d.docType,
    status: d.status,
    rejection_reason: d.rejectionReason,
    number: d.number,
    sub_type: d.subType,
    issued_on: toDateOnly(d.issuedOn),
    expires_on: toDateOnly(d.expiresOn),
    url: d.url
  };
}

export interface DriverControllerDeps {
  getProfile: GetDriverProfileUseCase;
  updateProfile: UpdateDriverProfileUseCase;
  requestProfilePictureUpload: RequestProfilePictureUploadUseCase;
  documents: ManageDriverDocumentsUseCase;
  submitOnboarding: SubmitOnboardingUseCase;
  setDuty: SetDutyStatusUseCase;
  recordLocation: RecordLocationPingsUseCase;
  devices: DriverDeviceRepositoryPort;
}

export interface DriverControllers {
  getProfile: RequestHandler;
  updateProfile: RequestHandler;
  requestProfilePictureUpload: RequestHandler;
  listDocuments: RequestHandler;
  requestDocumentUpload: RequestHandler;
  submitOnboarding: RequestHandler;
  setDuty: RequestHandler;
  recordLocation: RequestHandler;
  registerDevice: RequestHandler;
}

export function makeDriverControllers(deps: DriverControllerDeps): DriverControllers {
  return {
    getProfile: asyncHandler(async (req, res) => {
      const profile = await deps.getProfile.execute(subjectId(req));
      sendSuccess(req, res, profileToDto(profile), 'Profile');
    }),

    updateProfile: asyncHandler(async (req, res) => {
      const input = updateDriverProfileSchema.parse(req.body);

      const updated = await deps.updateProfile.execute(subjectId(req), {
        ...(input.full_name === undefined ? {} : { fullName: input.full_name }),
        ...(input.profile_picture === undefined ? {} : { profilePicture: input.profile_picture }),
        ...(input.dob === undefined ? {} : { dob: input.dob === null ? null : fromDateOnly(input.dob) }),
        ...(input.gender === undefined ? {} : { gender: input.gender }),
        ...(input.experience_years === undefined ? {} : { experienceYears: input.experience_years }),
        ...(input.alternate_number === undefined ? {} : { alternatePhone: input.alternate_number }),
        ...(input.emergency_contact === undefined
          ? {}
          : {
              emergencyContact:
                input.emergency_contact === null
                  ? null
                  : { name: input.emergency_contact.name, phone: input.emergency_contact.number },
            }),
        ...(input.address === undefined ? {} : { address: input.address }),
        ...(input.vehicle_type_preferences === undefined
          ? {}
          : { vehicleTypePreferences: input.vehicle_type_preferences }),
        ...(input.vehicle_category_preference === undefined
          ? {}
          : { vehicleCategoryPreference: input.vehicle_category_preference }),
        ...(input.can_drive_hill === undefined ? {} : { canDriveHill: input.can_drive_hill }),
      });

      sendSuccess(req, res, profileToDto(updated), 'Profile updated');
    }),

    requestProfilePictureUpload: asyncHandler(async (req, res) => {
      const presigned = await deps.requestProfilePictureUpload.execute(subjectId(req));
      const body: RequestProfilePictureUploadResponse = {
        upload_url: presigned.uploadUrl,
        expires_in_seconds: presigned.expiresInSeconds,
        storage_key: presigned.storageKey,
        // Same reason as the document route: the signature cannot be rebuilt client-side.
        ...(presigned.uploadFields === undefined ? {} : { upload_fields: presigned.uploadFields }),
      };
      sendSuccess(req, res, body, 'Upload authorised');
    }),

    listDocuments: asyncHandler(async (req, res) => {
      const documents = await deps.documents.list(subjectId(req));
      sendSuccess(req, res, documents.map(documentToDto), 'Documents');
    }),

    requestDocumentUpload: asyncHandler(async (req, res) => {
      const input = requestDocumentUploadSchema.parse(req.body);

      const result = await deps.documents.requestUpload(subjectId(req), {
        docType: input.doc_type,
        number: input.number,
        subType: input.sub_type,
        ...(input.issued_on === undefined ? {} : { issuedOn: fromDateOnly(input.issued_on) }),
        ...(input.expires_on === undefined ? {} : { expiresOn: fromDateOnly(input.expires_on) }),
      });

      const body: RequestDocumentUploadResponse = {
        document_id: result.document.id,
        upload_url: result.uploadUrl,
        expires_in_seconds: result.expiresInSeconds,
        // The signed form fields the provider demands. Without these the client holds a URL it
        // can only get a 401 from — see the contract's note on `upload_fields`.
        ...(result.uploadFields === undefined ? {} : { upload_fields: result.uploadFields }),
      };
      sendSuccess(req, res, body, 'Upload authorised');
    }),

    submitOnboarding: asyncHandler(async (req, res) => {
      const result = await deps.submitOnboarding.execute(subjectId(req));
      const body: SubmitOnboardingResponse = { onboarding_status: result.onboardingStatus };
      sendSuccess(req, res, body, 'Submitted for review');
    }),

    /**
     * Going on or off duty.
     *
     * Answers with the resulting STATE rather than echoing the request, so an app that asked for
     * ONLINE and was refused cannot paint itself on duty while dispatch ignores it.
     */
    setDuty: asyncHandler(async (req, res) => {
      const input = setDutyStatusSchema.parse(req.body);
      const result = await deps.setDuty.execute(subjectId(req), input.status);

      const body: DutyStateDto = { is_on_duty: result.isOnDuty };
      sendSuccess(req, res, body, result.isOnDuty ? 'You are on duty' : 'You are off duty');
    }),

    /**
     * A batch of GPS fixes. This is what keeps a driver in the dispatch pool — `MongoDriverPool`
     * drops anything whose `lastLocationAt` is more than two minutes old.
     */
    recordLocation: asyncHandler(async (req, res) => {
      const input = sendLocationPingsSchema.parse(req.body);

      const result = await deps.recordLocation.execute(
        subjectId(req),
        input.pings.map((p) => ({ lat: p.lat, lng: p.lng, recordedAt: new Date(p.recorded_at) })),
      );

      const body: LocationPingsAcceptedDto = {
        accepted: result.accepted,
        is_on_duty: result.isOnDuty,
      };
      sendSuccess(req, res, body, 'Location recorded');
    }),

    /**
     * Register this handset for push.
     *
     * Idempotent, because FCM hands the app the same token on every launch — the app calls this
     * on sign-in and on every rotation without checking whether it changed, which is the only way
     * to be sure a rotated token is never missed.
     */
    registerDevice: asyncHandler(async (req, res) => {
      const input = registerDeviceSchema.parse(req.body);
      await deps.devices.register(subjectId(req), input.fcm_token);

      const body: RegisterDeviceResponse = { registered: true };
      sendSuccess(req, res, body, 'Device registered');
    }),
  };
}
