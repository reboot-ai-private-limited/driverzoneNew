import { z } from 'zod';
import { OTP_LENGTH } from '../domain/otpChallenge.entity.js';

/**
 * INTERFACE — Zod at the boundary, per docs/engineering/coding-standards.md.
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

// ─── Shared field builders ──────────────────────────────────────────────────────────────────

/**
 * `.nullable()` where the wire type allows an explicit null, because clearing a field and
 * leaving it alone are different requests. `.optional()` alone cannot express "set this to
 * nothing" — see `UpdateCustomerProfileRequest` in @driverzone/contracts.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  // Rejects 2026-02-31, which the regex happily accepts and `new Date` silently rolls over.
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s), 'Not a real date');

const gender = z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']);

const emergencyContact = z.object({
  name: z.string().trim().min(1).max(80),
  number: mobileNumber,
});

/** Bounded so a single field cannot be used to store arbitrary payloads. */
const personName = z.string().trim().min(1).max(120);
const freeText = z.string().trim().min(1).max(500);

// ─── Customer profile ───────────────────────────────────────────────────────────────────────

export const updateCustomerProfileSchema = z.object({
  full_name: personName.optional(),
  dob: isoDate.nullable().optional(),
  gender: gender.nullable().optional(),
  languages_known: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  alternate_number: mobileNumber.nullable().optional(),
  emergency_contact: emergencyContact.nullable().optional(),
});

// ─── Addresses ──────────────────────────────────────────────────────────────────────────────

/**
 * Bounds are India-wide rather than global.
 *
 * A swapped lat/lng — the single most common coordinate bug — lands outside these and is
 * rejected here rather than resolving to a zone in the Indian Ocean
 * (docs/engineering/coding-standards.md §Coordinates).
 */
const latitude = z.number().min(6).max(38);
const longitude = z.number().min(68).max(98);

export const createAddressSchema = z.object({
  label: z.enum(['HOME', 'OFFICE', 'OTHER']),
  address: freeText,
  lat: latitude,
  lng: longitude,
  is_default: z.boolean().optional(),
  is_preferred_pickup: z.boolean().optional(),
});

export const updateAddressSchema = z.object({
  label: z.enum(['HOME', 'OFFICE', 'OTHER']).optional(),
  address: freeText.optional(),
  lat: latitude.optional(),
  lng: longitude.optional(),
  is_default: z.boolean().optional(),
  is_preferred_pickup: z.boolean().optional(),
});

// ─── Vehicles ───────────────────────────────────────────────────────────────────────────────

const fuelType = z.enum(['PETROL', 'DIESEL', 'EV', 'CNG']);

/**
 * Loose on format, strict on length. Indian plates come in several shapes (BH-series, older
 * state formats, dealer temporaries) and rejecting a real plate is far worse than accepting an
 * odd one — this is a label the driver reads off a car, not a key anything is derived from.
 */
const plateNumber = z.string().trim().min(4).max(16);

export const createVehicleSchema = z.object({
  category: z.string().trim().min(1).max(40),
  plate_number: plateNumber,
  fuel_type: fuelType.optional(),
  is_default: z.boolean().optional(),
});

export const updateVehicleSchema = z.object({
  category: z.string().trim().min(1).max(40).optional(),
  plate_number: plateNumber.optional(),
  fuel_type: fuelType.optional(),
  is_default: z.boolean().optional(),
});

// ─── Driver ─────────────────────────────────────────────────────────────────────────────────

export const updateDriverProfileSchema = z.object({
  full_name: personName.optional(),
  dob: isoDate.nullable().optional(),
  gender: gender.nullable().optional(),
  // Upper bound is a sanity check, not a policy: 70 years of driving is a typo.
  experience_years: z.number().int().min(0).max(70).nullable().optional(),
  alternate_number: mobileNumber.nullable().optional(),
  emergency_contact: emergencyContact.nullable().optional(),
  address: freeText.nullable().optional(),
  vehicle_type_preference: z.enum(['AUTO', 'MANUAL', 'EV']).nullable().optional(),
  vehicle_category_preference: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  // Self-declaration only. `can_drive_hill_verified` is absent by design — only an admin sets it.
  can_drive_hill: z.boolean().optional(),
});

export const requestDocumentUploadSchema = z.object({
  doc_type: z.enum(['LICENCE', 'AADHAAR', 'POLICE_VERIFICATION', 'VEHICLE_RC', 'INSURANCE']),
  number: z.string().trim().min(1).max(40).optional(),
  sub_type: z.string().trim().min(1).max(20).optional(),
  issued_on: isoDate.optional(),
  expires_on: isoDate.optional(),
});

// ─── Admin ──────────────────────────────────────────────────────────────────────────────────

export const updateAdminProfileSchema = z.object({
  full_name: personName.optional(),
});

export const rejectDriverSchema = z.object({
  // Required and non-empty: this text is the entire content of what the driver is told to fix.
  reason: freeText,
});

export const reviewDocumentSchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']),
  reason: freeText.optional(),
});

export type UpdateCustomerProfileInput = z.infer<typeof updateCustomerProfileSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type UpdateDriverProfileInput = z.infer<typeof updateDriverProfileSchema>;
export type RequestDocumentUploadInput = z.infer<typeof requestDocumentUploadSchema>;
export type UpdateAdminProfileInput = z.infer<typeof updateAdminProfileSchema>;
export type RejectDriverInput = z.infer<typeof rejectDriverSchema>;
export type ReviewDocumentInput = z.infer<typeof reviewDocumentSchema>;
