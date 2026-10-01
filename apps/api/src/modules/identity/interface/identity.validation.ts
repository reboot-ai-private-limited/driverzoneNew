import { z } from 'zod';
import {
  ADMIN_ROLES,
  CAR_CATEGORIES,
  DOCUMENT_SIDES,
  DOCUMENT_TYPES,
  OTP_CHANNELS,
  VEHICLE_TYPE_PREFERENCES,
} from '@driverzone/contracts';
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
  /*
   * Optional, because every client built before this field existed sends no channel at all — and
   * absent resolves to the same route those clients have always been given.
   */
  channel: z.enum(OTP_CHANNELS).optional(),
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
  profile_picture: freeText.nullable().optional(),
  dob: isoDate.nullable().optional(),
  gender: gender.nullable().optional(),
  // Upper bound is a sanity check, not a policy: 70 years of driving is a typo.
  experience_years: z.number().int().min(0).max(70).nullable().optional(),
  alternate_number: mobileNumber.nullable().optional(),
  emergency_contact: emergencyContact.nullable().optional(),
  address: freeText.nullable().optional(),
  /*
   * The two competency gates dispatch matches on, so both are closed enums rather than free
   * strings: a typo'd 'suv' used to be accepted and stored, and would then have silently matched
   * no booking forever. Empty arrays are legal and mean "not dispatchable yet".
   */
  vehicle_type_preferences: z.array(z.enum(VEHICLE_TYPE_PREFERENCES)).max(3).optional(),
  vehicle_category_preference: z
    .array(z.enum(CAR_CATEGORIES))
    .max(CAR_CATEGORIES.length)
    .optional(),
  // Self-declaration only. `can_drive_hill_verified` is absent by design — only an admin sets it.
  can_drive_hill: z.boolean().optional(),
});

export const requestDocumentUploadSchema = z.object({
  doc_type: z.enum(DOCUMENT_TYPES),
  /**
   * Optional, so a single-sided document (a police letter, a free-form extra) simply omits it and
   * lands as its own only face.
   *
   * Absent rather than `.default('FRONT')` deliberately: a Zod default makes the INFERRED type
   * required, which would break `identity.typecheck.ts`'s exact match against the contract, where
   * the field is optional. The fallback lives at the one call site instead.
   */
  side: z.enum(DOCUMENT_SIDES).optional(),
  number: z.string().trim().min(1).max(40).optional(),
  /**
   * The type-specific qualifier — see `DriverDocumentDto.sub_type`.
   *
   * 60, RAISED FROM 20 on 2026-09-04, because the field took on two jobs that do not fit in
   * twenty characters: every licence class comma-joined (`LMV,LMV-NT,MCWG,HMV,HGMV,PSV` is 28)
   * and the name of an issuing police station. Not validated per type here — the union of four
   * shapes in one field is a form concern, and the server's job is to refuse what could never be
   * legitimate rather than to re-model the document in Zod.
   */
  sub_type: z.string().trim().min(1).max(60).optional(),
  issued_on: isoDate.optional(),
  expires_on: isoDate.optional(),
});

// ─── Admin ──────────────────────────────────────────────────────────────────────────────────

export const updateAdminProfileSchema = z.object({
  full_name: personName.optional(),
});

export const createAdminUserSchema = z.object({
  mobile_number: mobileNumber,
  // Required, unlike a customer's: whoever adds an admin knows who they are adding.
  full_name: personName,
  admin_role: z.enum(ADMIN_ROLES),
});

export const updateAdminUserSchema = z
  .object({
    full_name: personName.optional(),
    admin_role: z.enum(ADMIN_ROLES).optional(),
  })
  .refine((v) => v.full_name !== undefined || v.admin_role !== undefined, 'Nothing to change');

export const adminIdParamSchema = z.object({
  id: z.string().min(1),
});
export const verifyHillDrivingSchema = z.object({
  verified: z.boolean(),
});


export const rejectDriverSchema = z.object({
  // Required and non-empty: this text is the entire content of what the driver is told to fix.
  reason: freeText,
});

export const suspendDriverSchema = z.object({
  is_suspended: z.boolean(),
  reason: freeText.optional(),
});

export const reviewDocumentSchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']),
  reason: freeText.optional(),
});

export const adminDriverListQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .refine((n) => !isNaN(n) && n >= 1, 'Page must be >= 1'),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 10))
    .refine((n) => !isNaN(n) && n >= 1 && n <= 100, 'Limit must be between 1 and 100'),
  onboarding_status: z.enum(['INCOMPLETE', 'SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
  is_verified: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().trim().optional(),
});

export const driverIdParamSchema = z.object({
  id: z.string().min(1),
});

export const adminDriverDutyHistoryQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .refine((n) => !isNaN(n) && n >= 1, 'Page must be >= 1'),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 10))
    .refine((n) => !isNaN(n) && n >= 1 && n <= 100, 'Limit must be between 1 and 100'),
});

/**
 * Mirrors `adminDriverListQuerySchema` — same paging contract for both admin directories.
 *
 * A query string carries strings only, so `page` and `limit` are parsed rather than coerced with
 * `z.coerce`. `is_blocked` is an enum of the two literals for the same reason
 * `is_verified` is: `z.coerce.boolean()` reads the string 'false' as true, since every non-empty
 * string is truthy.
 */
export const adminCustomerListQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .refine((n) => !isNaN(n) && n >= 1, 'Page must be >= 1'),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 10))
    .refine((n) => !isNaN(n) && n >= 1 && n <= 100, 'Limit must be between 1 and 100'),
  is_blocked: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().trim().max(120).optional(),
});

export const customerIdParamSchema = z.object({
  id: z.string().min(1),
});

/**
 * What an ADMIN may change on someone else's account.
 *
 * Deliberately NOT `updateCustomerProfileSchema`: `languages_known` and `emergency_contact` are
 * the customer's own to state, and `is_blocked` exists only here. Reusing the customer schema
 * with a field bolted on would mean every field added to the self-serve profile silently became
 * admin-editable too.
 */
export const adminUpdateCustomerSchema = z.object({
  full_name: personName.optional(),
  dob: isoDate.nullable().optional(),
  gender: gender.nullable().optional(),
  alternate_number: mobileNumber.nullable().optional(),
  is_blocked: z.boolean().optional(),
});

/** `POST /admin/customers` — the number IS the account, so it is the one required field. */
export const adminCreateCustomerSchema = z
  .object({
    mobile_number: mobileNumber,
    full_name: personName.optional(),
  })
  .strict();

export const adminUpdateDriverSchema = z.object({
  full_name: personName.optional(),
  dob: isoDate.nullable().optional(),
  gender: gender.nullable().optional(),
  experience_years: z.number().int().min(0).max(70).nullable().optional(),
  alternate_number: mobileNumber.nullable().optional(),
  emergency_contact: emergencyContact.nullable().optional(),
  address: freeText.nullable().optional(),
  vehicle_type_preferences: z.array(z.enum(VEHICLE_TYPE_PREFERENCES)).max(3).optional(),
  vehicle_category_preference: z
    .array(z.enum(CAR_CATEGORIES))
    .max(CAR_CATEGORIES.length)
    .optional(),
  can_drive_hill: z.boolean().optional(),
});

export const adminLiveDriversQuerySchema = z.object({
  duty_only: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  max_age_minutes: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .refine((n) => n === undefined || (!isNaN(n) && n >= 1 && n <= 1440), 'max_age_minutes must be between 1 and 1440'),
});


export type AdminUpdateDriverInput = z.infer<typeof adminUpdateDriverSchema>;


export type UpdateCustomerProfileInput = z.infer<typeof updateCustomerProfileSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type UpdateDriverProfileInput = z.infer<typeof updateDriverProfileSchema>;
export type RequestDocumentUploadInput = z.infer<typeof requestDocumentUploadSchema>;
export type UpdateAdminProfileInput = z.infer<typeof updateAdminProfileSchema>;
export type RejectDriverInput = z.infer<typeof rejectDriverSchema>;
export type SuspendDriverInput = z.infer<typeof suspendDriverSchema>;
export type ReviewDocumentInput = z.infer<typeof reviewDocumentSchema>;

/** `POST /driver/duty` — the driver going on or off duty. */
export const setDutyStatusSchema = z.object({
  status: z.enum(['ONLINE', 'OFFLINE']),
});
export type SetDutyStatusInput = z.infer<typeof setDutyStatusSchema>;

/**
 * `POST /driver/location` — a batch of GPS fixes.
 *
 * Three fields, and each one is read: `lat`/`lng` become `lastLocation`, `recorded_at` becomes
 * `lastLocationAt` and also decides which ping in the batch wins. Nothing else is accepted —
 * `accuracy_m`, `heading` and `speed_mps` used to be, and were parsed and then dropped on the
 * floor by the controller, which is a contract that lies about what the endpoint does.
 *
 * Capped at 50 as an ABUSE GUARD, not as a description of the client. The app sends one ping per
 * flush in steady state and a short backlog after an offline stretch; 50 is deliberately far above
 * either, so the cap only ever catches something pathological. Only the newest is stored whatever
 * arrives.
 */
export const sendLocationPingsSchema = z.object({
  pings: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        recorded_at: z.string().datetime(),
      }),
    )
    .min(1)
    .max(50),
});
export type SendLocationPingsInput = z.infer<typeof sendLocationPingsSchema>;

/** `POST /driver/devices` and `POST /customer/devices` — register this handset's FCM token. */
export const registerDeviceSchema = z.object({
  fcm_token: z.string().trim().min(10).max(4096),
  platform: z.enum(['android', 'ios']),
  app_version: z.string().trim().max(32).optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

/** `DELETE /customer/devices` — withdraw one handset on sign-out. */
export const deleteDeviceSchema = z.object({
  fcm_token: z.string().trim().min(10).max(4096),
});
export type DeleteDeviceInput = z.infer<typeof deleteDeviceSchema>;
