import type { Request, RequestHandler } from 'express';
import type {
  AdminProfileDto,
  AdminDriverListDto,
  AdminDriverDetailsDto,
  DriverProfileDto,
  DriverDocumentDto,
  ApproveDriverResponse,
  RejectDriverResponse,
  ReviewDocumentResponse,
} from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { ManageAdminProfileUseCase } from '../application/useCases/manageAdminProfile.usecase.js';
import type { VerifyDriverUseCase } from '../application/useCases/verifyDriver.usecase.js';
import type { ListDriversAdminUseCase } from '../application/useCases/listDriversAdmin.usecase.js';
import type { GetDriverDetailsAdminUseCase } from '../application/useCases/getDriverDetailsAdmin.usecase.js';
import type { DriverProfile } from '../domain/driverProfile.repository.port.js';
import type { DriverDocument } from '../domain/driverDocument.repository.port.js';
import {
  rejectDriverSchema,
  reviewDocumentSchema,
  updateAdminProfileSchema,
  adminDriverListQuerySchema,
  driverIdParamSchema,
} from './identity.validation.js';

/**
 * INTERFACE — an admin's own profile, and the driver verification actions.
 *
 * Unlike the customer and driver controllers, these handlers act on OTHER people's records, so
 * the subject arrives in the path. The admin's own id still comes from `req.principal` and is
 * never taken from the request — it is what every audit entry is attributed to, and an
 * attributable-to-anyone audit log is not an audit log.
 */

function actorId(req: Request): string {
  const id = req.principal?.sub;
  if (id === undefined) throw AppError.unauthenticated();
  return id;
}

function mapDriverProfileToDto(driver: DriverProfile, profilePictureUrl: string | null = null): DriverProfileDto {
  return {
    id: driver.id,
    mobile_number: driver.mobileNumber,
    full_name: driver.fullName,
    // The profile picture field in the DTO should probably contain the fully resolved URL.
    // If not passed, we default to the raw db string (though usually we want to resolve it).
    profile_picture: profilePictureUrl ?? driver.profilePicture,
    dob: driver.dob ? driver.dob.toISOString().split('T')[0]! : null,
    gender: driver.gender,
    experience_years: driver.experienceYears,
    alternate_number: driver.alternatePhone,
    emergency_contact: driver.emergencyContact
      ? { name: driver.emergencyContact.name, number: driver.emergencyContact.phone }
      : null,
    address: driver.address,
    vehicle_type_preference: driver.vehicleTypePreference,
    vehicle_category_preference: driver.vehicleCategoryPreference,
    can_drive_hill: driver.canDriveHill,
    can_drive_hill_verified: driver.canDriveHillVerified,
    onboarding_status: driver.onboardingStatus,
    onboarding_rejection_reason: driver.onboardingRejectionReason,
    is_verified: driver.isVerified,
  };
}

function mapDriverDocumentToDto(doc: DriverDocument, url: string = ''): DriverDocumentDto {
  return {
    id: doc.id,
    doc_type: doc.docType,
    status: doc.status,
    rejection_reason: doc.rejectionReason,
    number: doc.number,
    sub_type: doc.subType,
    issued_on: doc.issuedOn ? doc.issuedOn.toISOString().split('T')[0]! : null,
    expires_on: doc.expiresOn ? doc.expiresOn.toISOString().split('T')[0]! : null,
    url
  };
}

export interface AdminControllerDeps {
  profile: ManageAdminProfileUseCase;
  verifyDriver: VerifyDriverUseCase;
  listDrivers: ListDriversAdminUseCase;
  getDriverDetails: GetDriverDetailsAdminUseCase;
}

export interface AdminControllers {
  getProfile: RequestHandler;
  updateProfile: RequestHandler;
  approveDriver: RequestHandler;
  rejectDriver: RequestHandler;
  reviewDocument: RequestHandler;
  listDrivers: RequestHandler;
  getDriverDetails: RequestHandler;
}

export function makeAdminControllers(deps: AdminControllerDeps): AdminControllers {
  return {
    getProfile: asyncHandler(async (req, res) => {
      const profile = await deps.profile.get(actorId(req));
      const body: AdminProfileDto = {
        id: profile.id,
        mobile_number: profile.mobileNumber,
        full_name: profile.fullName,
      };
      sendSuccess(req, res, body, 'Profile');
    }),

    updateProfile: asyncHandler(async (req, res) => {
      const input = updateAdminProfileSchema.parse(req.body);
      const updated = await deps.profile.update(actorId(req), {
        ...(input.full_name === undefined ? {} : { fullName: input.full_name }),
      });
      const body: AdminProfileDto = {
        id: updated.id,
        mobile_number: updated.mobileNumber,
        full_name: updated.fullName,
      };
      sendSuccess(req, res, body, 'Profile updated');
    }),

    approveDriver: asyncHandler(async (req, res) => {
      const driver = await deps.verifyDriver.approve(req.params['id'] ?? '', {
        adminId: actorId(req),
        ip: req.ip,
      });
      const body: ApproveDriverResponse = {
        onboarding_status: driver.onboardingStatus,
        is_verified: driver.isVerified,
      };
      sendSuccess(req, res, body, 'Driver approved');
    }),

    rejectDriver: asyncHandler(async (req, res) => {
      const input = rejectDriverSchema.parse(req.body);
      const driver = await deps.verifyDriver.reject(req.params['id'] ?? '', input.reason, {
        adminId: actorId(req),
        ip: req.ip,
      });
      const body: RejectDriverResponse = { onboarding_status: driver.onboardingStatus };
      sendSuccess(req, res, body, 'Driver rejected');
    }),

    reviewDocument: asyncHandler(async (req, res) => {
      const input = reviewDocumentSchema.parse(req.body);
      const document = await deps.verifyDriver.reviewDocument(
        req.params['docId'] ?? '',
        input.status,
        input.reason,
        { adminId: actorId(req), ip: req.ip },
      );
      const body: ReviewDocumentResponse = { document_id: document.id, status: document.status };
      sendSuccess(req, res, body, 'Document reviewed');
    }),

    listDrivers: asyncHandler(async (req, res) => {
      const input = adminDriverListQuerySchema.parse(req.query);

      const filter: Parameters<typeof deps.listDrivers.execute>[0] = {};
      if (input.onboarding_status !== undefined) filter.onboardingStatus = input.onboarding_status;
      if (input.is_verified !== undefined) filter.isVerified = input.is_verified;
      if (input.search !== undefined) filter.search = input.search;

      const { drivers, totalItems } = await deps.listDrivers.execute(
        filter,
        input.page,
        input.limit
      );

      const body: AdminDriverListDto = {
        drivers: drivers.map(d => mapDriverProfileToDto(d)),
        pagination: {
          page: input.page,
          limit: input.limit,
          total_items: totalItems,
          total_pages: Math.ceil(totalItems / input.limit),
        },
      };
      sendSuccess(req, res, body, 'Drivers listed');
    }),

    getDriverDetails: asyncHandler(async (req, res) => {
      const { id } = driverIdParamSchema.parse(req.params);
      const { profile, documents } = await deps.getDriverDetails.execute(id);

      const body: AdminDriverDetailsDto = {
        profile: mapDriverProfileToDto(profile, profile.profilePictureUrl),
        documents: documents.map((doc) => mapDriverDocumentToDto(doc, doc.url)),
      };
      sendSuccess(req, res, body, 'Driver details retrieved');
    }),
  };
}

