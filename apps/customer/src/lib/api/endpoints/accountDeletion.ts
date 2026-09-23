import type {
  AccountDeletedDto,
  AccountDeletionPreviewDto,
  ConfirmAccountDeletionRequest,
  OtpChannel,
  OtpSendResponse,
} from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { request } from '../client';
import { getAccessToken } from '../../auth/session';

/**
 * `/{role}/account/deletion` — closing this account from inside the app
 * (apps/api/src/modules/accounts). The code goes to the account's OWN number, so none of these
 * calls carries one: the server reads it from the session.
 *
 * Deleting erases the person's data and signs them out everywhere. The caller must sign this
 * device out as soon as `deleteAccount` resolves.
 */

/** Whether the account can close right now, and what would be lost. Sends nothing. */
export function getDeletionPreview(): Promise<AccountDeletionPreviewDto> {
  return request<AccountDeletionPreviewDto>(`${ROLE_PREFIX}/account/deletion`, {
    token: getAccessToken() ?? undefined,
  });
}

/** Refused with `ACCOUNT_DELETION_BLOCKED` (and every reason) before any code is sent. */
export function sendDeletionCode(channel?: OtpChannel): Promise<OtpSendResponse> {
  return request<OtpSendResponse>(`${ROLE_PREFIX}/account/deletion/otp`, {
    method: 'POST',
    body: channel === undefined ? {} : { channel },
    token: getAccessToken() ?? undefined,
  });
}

export function deleteAccount(otp: string): Promise<AccountDeletedDto> {
  const body: ConfirmAccountDeletionRequest = { otp };
  return request<AccountDeletedDto>(`${ROLE_PREFIX}/account/deletion`, {
    method: 'POST',
    body,
    token: getAccessToken() ?? undefined,
  });
}
