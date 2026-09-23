import { z } from 'zod';
import { OTP_CHANNELS } from '@driverzone/contracts';

/**
 * INTERFACE — Zod at the boundary. The phone and code rules are the login flow's own, repeated
 * rather than imported: identity's validation file is its internals, and the two must agree on the
 * wire, which the shared contract types already pin down.
 */

const mobileNumber = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Enter a mobile number in international format, e.g. +919876543210');

const otp = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const deletionOtpSchema = z.object({
  channel: z.enum(OTP_CHANNELS).optional(),
});

export const confirmDeletionSchema = z.object({ otp });

export const publicDeletionOtpSchema = z.object({
  mobile_number: mobileNumber,
  channel: z.enum(OTP_CHANNELS).optional(),
});

export const publicConfirmDeletionSchema = z.object({
  mobile_number: mobileNumber,
  otp,
});

/** The role in the public path is a lowercase word, the same spelling as `/api/customer/…`. */
export const publicRoleParamSchema = z.object({
  role: z
    .enum(['customer', 'driver'])
    .transform((r): 'CUSTOMER' | 'DRIVER' => (r === 'customer' ? 'CUSTOMER' : 'DRIVER')),
});

export const adminDeleteAccountSchema = z.object({
  // Required: it is the only record of WHY somebody's account was closed by someone else.
  reason: z.string().trim().min(3).max(500),
});

export const accountIdParamSchema = z.object({
  id: z.string().min(1),
});
