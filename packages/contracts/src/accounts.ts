import type { OtpChannel } from './identity.js';

/**
 * Account deletion — customers and drivers closing their own account, from the app or from the
 * public `/delete-account` page, and a SUPER_ADMIN closing one on request.
 *
 * Closing ANONYMISES: personal data is erased, trip and payment records are kept without a name
 * on them. See docs/decision-log.md, 2026-09-23.
 */

/**
 * Why an account cannot close yet. Clients render `message`; `code` is for logic, and an unknown
 * code must still render — the message is always customer-safe.
 */
export const ACCOUNT_DELETION_BLOCKERS = [
  /** A trip that is not finished, including one booked for later. */
  'OPEN_BOOKING',
  /** A driver still on duty. */
  'ON_DUTY',
  /** A customer owing money on their wallet. */
  'WALLET_DEBT',
  /** A driver whose earnings or commission are not settled, in either direction. */
  'UNSETTLED_BALANCE',
] as const;
export type AccountDeletionBlockerCode = (typeof ACCOUNT_DELETION_BLOCKERS)[number];

export interface AccountDeletionBlocker {
  code: AccountDeletionBlockerCode;
  message: string;
}

/**
 * `GET /{customer|driver}/account/deletion` — what the confirm screen shows before any code is
 * sent: whether the account can close now, and what will be lost.
 */
export interface AccountDeletionPreviewDto {
  can_delete: boolean;
  blockers: AccountDeletionBlocker[];
  /** Customer wallet credit that is forfeited on deletion, in paise. 0 for a driver. */
  forfeited_wallet_credit_paise: number;
}

/**
 * `POST /{customer|driver}/account/deletion/otp` (signed in — sent to the account's own number).
 * `channel` has the same meaning as on login.
 */
export interface AccountDeletionOtpRequest {
  channel?: OtpChannel | undefined;
}

/** `POST /{customer|driver}/account/deletion` (signed in). */
export interface ConfirmAccountDeletionRequest {
  otp: string;
}

/**
 * `POST /account-deletion/{customer|driver}/otp` — the public web form, for someone who has
 * uninstalled the app. Always answers the same way whether or not the number has an account.
 */
export interface PublicAccountDeletionOtpRequest {
  mobile_number: string;
  channel?: OtpChannel | undefined;
}

/** `POST /account-deletion/{customer|driver}/confirm`. */
export interface PublicConfirmAccountDeletionRequest {
  mobile_number: string;
  otp: string;
}

/** Every successful deletion answers with this. The client should sign out immediately. */
export interface AccountDeletedDto {
  deleted: true;
}

/**
 * `POST /admin/{customers|drivers}/:id/delete-account` — SUPER_ADMIN only. No OTP: the admin has
 * verified the request themselves (usually the emailed route on the public page). `reason` goes
 * into the audit log.
 */
export interface AdminDeleteAccountRequest {
  reason: string;
}
