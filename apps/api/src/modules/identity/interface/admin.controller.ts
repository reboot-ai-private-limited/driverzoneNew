import type { Request, RequestHandler } from 'express';
import type {
  AdminProfileDto,
  ApproveDriverResponse,
  RejectDriverResponse,
  ReviewDocumentResponse,
} from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { ManageAdminProfileUseCase } from '../application/useCases/manageAdminProfile.usecase.js';
import type { VerifyDriverUseCase } from '../application/useCases/verifyDriver.usecase.js';
import { rejectDriverSchema, reviewDocumentSchema, updateAdminProfileSchema } from './identity.validation.js';

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

export interface AdminControllerDeps {
  profile: ManageAdminProfileUseCase;
  verifyDriver: VerifyDriverUseCase;
}

export interface AdminControllers {
  getProfile: RequestHandler;
  updateProfile: RequestHandler;
  approveDriver: RequestHandler;
  rejectDriver: RequestHandler;
  reviewDocument: RequestHandler;
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
  };
}
