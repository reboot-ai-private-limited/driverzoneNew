import type { Request, RequestHandler } from 'express';
import type {
  AccountDeletedDto,
  AccountDeletionPreviewDto,
  OtpSendResponse,
} from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { ClosableRole } from '../../identity/identity.public.js';
import type { DeleteAccountUseCase } from '../application/deleteAccount.usecase.js';
import {
  accountIdParamSchema,
  adminDeleteAccountSchema,
  confirmDeletionSchema,
  deletionOtpSchema,
  publicConfirmDeletionSchema,
  publicDeletionOtpSchema,
  publicRoleParamSchema,
} from './accounts.validation.js';

/** The signed-in principal. The role is the ROUTER's, never read from the request. */
function principalId(req: Request): string {
  const id = req.principal?.sub;
  if (id === undefined) throw AppError.unauthenticated();
  return id;
}

function codeSent(result: { expiresInSeconds: number; retryAfterSeconds: number }): OtpSendResponse {
  return {
    sent: true,
    expires_in_seconds: result.expiresInSeconds,
    retry_after_seconds: result.retryAfterSeconds,
  };
}

const DELETED: AccountDeletedDto = { deleted: true };

export interface SelfDeletionControllers {
  preview: RequestHandler;
  requestCode: RequestHandler;
  confirm: RequestHandler;
}

/** `/{customer|driver}/account/deletion` — the signed-in user closing their own account. */
export function makeSelfDeletionControllers(
  role: ClosableRole,
  deletion: DeleteAccountUseCase,
): SelfDeletionControllers {
  return {
    preview: asyncHandler(async (req, res) => {
      const preview = await deletion.preview(role, principalId(req));
      const body: AccountDeletionPreviewDto = {
        can_delete: preview.blockers.length === 0,
        blockers: preview.blockers,
        forfeited_wallet_credit_paise: preview.forfeitedCreditPaise,
      };
      sendSuccess(req, res, body, 'Account deletion');
    }),

    requestCode: asyncHandler(async (req, res) => {
      const input = deletionOtpSchema.parse(req.body ?? {});
      const result = await deletion.requestCode(role, principalId(req), req.ip, input.channel);
      sendSuccess(req, res, codeSent(result), 'Code sent');
    }),

    confirm: asyncHandler(async (req, res) => {
      const input = confirmDeletionSchema.parse(req.body);
      await deletion.confirm(role, principalId(req), input.otp);
      sendSuccess(req, res, DELETED, 'Account deleted');
    }),
  };
}

export interface PublicDeletionControllers {
  requestCode: RequestHandler;
  confirm: RequestHandler;
}

/** `/account-deletion/:role` — the web form, no session. */
export function makePublicDeletionControllers(
  deletion: DeleteAccountUseCase,
): PublicDeletionControllers {
  return {
    requestCode: asyncHandler(async (req, res) => {
      const { role } = publicRoleParamSchema.parse(req.params);
      const input = publicDeletionOtpSchema.parse(req.body);
      const result = await deletion.requestCodeByPhone(role, input.mobile_number, req.ip, input.channel);
      // "If this number has an account, a code is on its way" — the client says it that way.
      sendSuccess(req, res, codeSent(result), 'Code sent');
    }),

    confirm: asyncHandler(async (req, res) => {
      const { role } = publicRoleParamSchema.parse(req.params);
      const input = publicConfirmDeletionSchema.parse(req.body);
      await deletion.confirmByPhone(role, input.mobile_number, input.otp);
      sendSuccess(req, res, DELETED, 'Account deleted');
    }),
  };
}

/** `POST /admin/{customers|drivers}/:id/delete-account` — SUPER_ADMIN. */
export function makeAdminDeletionController(
  role: ClosableRole,
  deletion: DeleteAccountUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = accountIdParamSchema.parse(req.params);
    const input = adminDeleteAccountSchema.parse(req.body);
    await deletion.closeByAdmin(role, id, { adminId: principalId(req), ip: req.ip, reason: input.reason });
    sendSuccess(req, res, DELETED, 'Account deleted');
  });
}
