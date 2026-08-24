import { z } from 'zod';
import { OTP_LENGTH } from '../domain/otpChallenge.entity.js';

/**
 * INTERFACE — Zod at the boundary, per docs/engineering/05-coding-standards.md.
 *
 * Parsed once here into a typed DTO; the use cases receive validated data and never re-check it.
 * Shapes are snake_case because that is the wire convention — the mapping to camelCase domain
 * fields happens in the controller.
 */

/**
 * E.164, which is what a telephony provider will require anyway.
 *
 * Deliberately strict rather than accommodating: accepting `9876543210` and `+91 98765 43210`
 * as well would mean the same human is two different Redis keys and potentially two accounts,
 * since the phone number IS the identity here. Normalising leniently is a trap — one client
 * sending a space makes a second account that looks identical in every UI. Clients normalise
 * before sending; the server refuses anything else.
 */
const mobileNumber = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Enter a mobile number in international format, e.g. +919876543210');

export const otpSendSchema = z.object({
  mobile_number: mobileNumber,
});

export const otpVerifySchema = z.object({
  mobile_number: mobileNumber,
  // Exactly N digits. `.length` rather than min/max so a 5- or 7-digit guess is rejected as
  // malformed input before it ever costs the caller one of their five attempts.
  otp: z.string().trim().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), 'Enter the 6-digit code'),
});

/**
 * Optional because admin sends no body at all — its token arrives in a cookie. The controller
 * decides which source applies for the role it was built for.
 */
export const refreshSchema = z.object({
  refresh_token: z.string().min(1).optional(),
});

export const logoutSchema = refreshSchema;

export type OtpSendInput = z.infer<typeof otpSendSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
