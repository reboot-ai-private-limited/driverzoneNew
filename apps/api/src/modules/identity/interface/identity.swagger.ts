import { z } from 'zod';
import { CAR_CATEGORIES, VEHICLE_TYPE_PREFERENCES } from '@driverzone/contracts';
import { bearerAuth, errorResponse, registry, successResponse } from '@/shared/http/swagger.util.js';
import {
  createAddressSchema,
  createVehicleSchema,
  otpSendSchema,
  otpVerifySchema,
  refreshSchema,
  logoutSchema,
  updateAddressSchema,
  updateCustomerProfileSchema,
  updateVehicleSchema,
  adminDriverListQuerySchema,
  driverIdParamSchema,
  rejectDriverSchema,
  reviewDocumentSchema,
  verifyHillDrivingSchema,
} from './identity.validation.js';

// ─── Response DTOs — mirror @driverzone/contracts/src/identity.ts ───────────────────────────

const otpSendResponseSchema = z.object({
  sent: z.literal(true),
  expires_in_seconds: z.number(),
  retry_after_seconds: z.number(),
});

const authUserDtoSchema = z.object({
  id: z.string(),
  mobile_number: z.string(),
  full_name: z.string().nullable(),
});

const otpVerifyCustomerDriverResponseSchema = z.object({
  is_new_user: z.boolean(),
  access_token: z.string(),
  refresh_token: z.string(),
  user: authUserDtoSchema,
});

const otpVerifyAdminResponseSchema = z.object({
  access_token: z.string(),
  user: authUserDtoSchema,
});

const refreshCustomerDriverResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
});

const refreshAdminResponseSchema = z.object({
  access_token: z.string(),
});

const logoutResponseSchema = z.object({
  logged_out: z.literal(true),
});

// ─── Customer profile response DTOs ─────────────────────────────────────────────────────────

const savedAddressDtoSchema = z.object({
  id: z.string(),
  label: z.enum(['HOME', 'OFFICE', 'OTHER']),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  is_default: z.boolean(),
  is_preferred_pickup: z.boolean(),
});

const vehicleDtoSchema = z.object({
  id: z.string(),
  category: z.string(),
  plate_number: z.string(),
  fuel_type: z.enum(['PETROL', 'DIESEL', 'EV', 'CNG']).nullable(),
  is_default: z.boolean(),
});

/**
 * Every field except `mobile_number` is nullable, and that mirrors the contract rather than
 * being cautious: an account is created by `otp/verify` holding nothing but a phone number, and
 * no endpoint here ever requires more. A generated client that marked these required would
 * reject the response a brand-new customer actually gets.
 */
const customerProfileDtoSchema = z.object({
  id: z.string(),
  mobile_number: z.string(),
  full_name: z.string().nullable(),
  dob: z.string().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).nullable(),
  languages_known: z.array(z.string()),
  alternate_number: z.string().nullable(),
  emergency_contact: z.object({ name: z.string(), number: z.string() }).nullable(),
  saved_addresses: z.array(savedAddressDtoSchema),
  vehicles: z.array(vehicleDtoSchema),
});

const deletedResponseSchema = z.object({ deleted: z.literal(true) });

/**
 * An `adr_`/`veh_` string, NOT an ObjectId — these subdocuments carry an application-generated
 * id so it survives the whole-list rewrites the "only one default" invariant forces
 * (`customer.model.ts`). Documenting it as an ObjectId would send integrators looking for one.
 */
const entryIdParams = z.object({
  id: z.string().openapi({ description: 'Address or vehicle entry id, e.g. adr_… / veh_…' }),
});

const paginationDtoSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total_items: z.number(),
  total_pages: z.number(),
});

const driverProfileDtoSchema = z.object({
  id: z.string(),
  mobile_number: z.string(),
  full_name: z.string().nullable(),
  profile_picture: z.string().nullable(),
  dob: z.string().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).nullable(),
  experience_years: z.number().nullable(),
  alternate_number: z.string().nullable(),
  emergency_contact: z.object({ name: z.string(), number: z.string() }).nullable(),
  address: z.string().nullable(),
  vehicle_type_preferences: z.array(z.enum(VEHICLE_TYPE_PREFERENCES)),
  vehicle_category_preference: z.array(z.enum(CAR_CATEGORIES)),
  can_drive_hill: z.boolean(),
  can_drive_hill_verified: z.boolean(),
  onboarding_status: z.enum(['INCOMPLETE', 'SUBMITTED', 'APPROVED', 'REJECTED']),
  onboarding_rejection_reason: z.string().nullable(),
  is_verified: z.boolean(),
});

const adminDriverListResponseSchema = z.object({
  drivers: z.array(driverProfileDtoSchema),
  pagination: paginationDtoSchema,
});

const driverDocumentDtoSchema = z.object({
  id: z.string(),
  doc_type: z.enum(['LICENCE', 'AADHAAR', 'POLICE_VERIFICATION', 'VEHICLE_RC', 'INSURANCE']),
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']),
  rejection_reason: z.string().nullable(),
  number: z.string().nullable(),
  sub_type: z.string().nullable(),
  issued_on: z.string().nullable(),
  expires_on: z.string().nullable(),
  url: z.string(),
});

const adminDriverDetailsResponseSchema = z.object({
  profile: driverProfileDtoSchema,
  documents: z.array(driverDocumentDtoSchema),
});

const adminDriverWalletDetailsResponseSchema = z.object({
  wallet: z.object({
    balance_paise: z.number(),
    is_suspended_for_balance: z.boolean(),
    lifetime_earnings_paise: z.number(),
  }),
  ledger: z.array(z.object({
    id: z.string(),
    driver_id: z.string(),
    type: z.enum(['TRIP_EARNING', 'COMMISSION_DEDUCTION', 'PAYOUT', 'ADJUSTMENT', 'PENALTY']),
    amount_paise: z.number(),
    balance_after_paise: z.number(),
    reference_id: z.string().nullable(),
    description: z.string(),
    created_at: z.string(),
  })),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total_items: z.number(),
    total_pages: z.number(),
  })
});

const adminDriverDutyHistoryResponseSchema = z.object({
  sessions: z.array(z.object({
    id: z.string(),
    driver_id: z.string(),
    started_at: z.string(),
    ended_at: z.string().nullable(),
    duration_minutes: z.number(),
    trips_completed: z.number(),
    earnings_paise: z.number(),
  })),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total_items: z.number(),
    total_pages: z.number(),
  })
});

const approveDriverResponseSchema = z.object({
  onboarding_status: z.enum(['INCOMPLETE', 'SUBMITTED', 'APPROVED', 'REJECTED']),
  is_verified: z.boolean(),
});

const rejectDriverResponseSchema = z.object({
  onboarding_status: z.enum(['INCOMPLETE', 'SUBMITTED', 'APPROVED', 'REJECTED']),
});

const reviewDocumentResponseSchema = z.object({
  document_id: z.string(),
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']),
});

const requestProfilePictureUploadResponseSchema = z.object({
  upload_url: z.string(),
  expires_in_seconds: z.number(),
  storage_key: z.string(),
});

// ─── Shared error response entries ─────────────────────────────────────────────────────────────

const jsonError = { content: { 'application/json': { schema: errorResponse } } };
const unauthenticated = { description: 'Missing or invalid bearer token', ...jsonError };
const rateLimited = { description: 'Too many requests / cooldown active', ...jsonError };

const notFound = { description: 'Profile, address or vehicle not found', ...jsonError };
const forbidden = { description: 'Valid token, wrong role', ...jsonError };
const validationFailed = { description: 'Request body failed validation', ...jsonError };

const roles = ['customer', 'driver', 'admin'] as const;

/**
 * The customer's own account surface — the routes `customer.routes.ts` already mounts.
 *
 * Every path here is `requireAuth('CUSTOMER')` and acts on `req.principal`: there is no customer
 * id anywhere in a path or body, because a customer may only ever act on themselves. That is
 * worth reading off the doc as much as off the router, so no `{customerId}` appears below.
 */
function registerCustomerProfilePaths(): void {
  const tags = ['Customer profile'];

  registry.registerPath({
    method: 'get',
    path: '/customer/profile',
    tags,
    summary: "Get the signed-in customer's profile",
    description: 'Includes saved addresses and vehicles. The subject is the token, never a parameter.',
    security: bearerAuth,
    responses: {
      200: { description: 'Profile', content: { 'application/json': { schema: successResponse(customerProfileDtoSchema) } } },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/customer/profile',
    tags,
    summary: 'Update the profile',
    description:
      'PATCH semantics: an omitted key leaves the field alone, an explicit null clears it. Addresses and vehicles are not editable here — they have their own routes.',
    security: bearerAuth,
    request: { body: { content: { 'application/json': { schema: updateCustomerProfileSchema } } } },
    responses: {
      200: { description: 'Profile updated', content: { 'application/json': { schema: successResponse(customerProfileDtoSchema) } } },
      400: validationFailed,
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/customer/addresses',
    tags,
    summary: 'Save an address',
    description:
      "The first address a customer saves becomes their default and preferred pickup automatically. Setting either flag on a later address clears it from the previous holder — the two flags are cleared independently.",
    security: bearerAuth,
    request: { body: { content: { 'application/json': { schema: createAddressSchema } } } },
    responses: {
      201: { description: 'Address saved', content: { 'application/json': { schema: successResponse(savedAddressDtoSchema) } } },
      400: validationFailed,
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/customer/addresses/{id}',
    tags,
    summary: 'Update a saved address',
    security: bearerAuth,
    request: { params: entryIdParams, body: { content: { 'application/json': { schema: updateAddressSchema } } } },
    responses: {
      200: { description: 'Address updated', content: { 'application/json': { schema: successResponse(savedAddressDtoSchema) } } },
      400: validationFailed,
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/customer/addresses/{id}',
    tags,
    summary: 'Remove a saved address',
    security: bearerAuth,
    request: { params: entryIdParams },
    responses: {
      200: { description: 'Address removed', content: { 'application/json': { schema: successResponse(deletedResponseSchema) } } },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/customer/vehicles',
    tags,
    summary: "Save a vehicle",
    description:
      "The CUSTOMER's own car — the driver drives it rather than supplying one. Plates are compared case-insensitively with separators stripped, so `WB 74 AB-1234` and `wb74ab1234` are the same car.",
    security: bearerAuth,
    request: { body: { content: { 'application/json': { schema: createVehicleSchema } } } },
    responses: {
      201: { description: 'Vehicle saved', content: { 'application/json': { schema: successResponse(vehicleDtoSchema) } } },
      400: validationFailed,
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: { description: 'That vehicle is already saved — the response carries the existing vehicle_id', ...jsonError },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/customer/vehicles/{id}',
    tags,
    summary: 'Update a saved vehicle',
    security: bearerAuth,
    request: { params: entryIdParams, body: { content: { 'application/json': { schema: updateVehicleSchema } } } },
    responses: {
      200: { description: 'Vehicle updated', content: { 'application/json': { schema: successResponse(vehicleDtoSchema) } } },
      400: validationFailed,
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: { description: 'Another saved vehicle already uses that number plate', ...jsonError },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/customer/vehicles/{id}',
    tags,
    summary: 'Remove a saved vehicle',
    security: bearerAuth,
    request: { params: entryIdParams },
    responses: {
      200: { description: 'Vehicle removed', content: { 'application/json': { schema: successResponse(deletedResponseSchema) } } },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  });
}

export function registerIdentitySwaggerPaths(): void {
  registerCustomerProfilePaths();

  for (const role of roles) {
    const isCustomerOrDriver = role === 'customer' || role === 'driver';
    const tags = [`Auth (${role})`];

    // POST /{role}/auth/otp/send
    registry.registerPath({
      method: 'post',
      path: `/${role}/auth/otp/send`,
      tags,
      summary: `Send OTP for ${role}`,
      request: { body: { content: { 'application/json': { schema: otpSendSchema } } } },
      responses: {
        200: { description: 'OTP sent', content: { 'application/json': { schema: successResponse(otpSendResponseSchema) } } },
        429: rateLimited,
      },
    });

    // POST /{role}/auth/otp/verify
    registry.registerPath({
      method: 'post',
      path: `/${role}/auth/otp/verify`,
      tags,
      summary: `Verify OTP for ${role}`,
      request: { body: { content: { 'application/json': { schema: otpVerifySchema } } } },
      responses: {
        200: {
          description: 'OTP verified',
          content: {
            'application/json': {
              schema: successResponse(
                isCustomerOrDriver ? otpVerifyCustomerDriverResponseSchema : otpVerifyAdminResponseSchema
              ),
            },
          },
        },
        401: unauthenticated,
        429: rateLimited,
      },
    });

    // POST /{role}/auth/refresh
    registry.registerPath({
      method: 'post',
      path: `/${role}/auth/refresh`,
      tags,
      summary: `Refresh token for ${role}`,
      request: { body: { content: { 'application/json': { schema: refreshSchema } } } },
      responses: {
        200: {
          description: 'Token refreshed',
          content: {
            'application/json': {
              schema: successResponse(
                isCustomerOrDriver ? refreshCustomerDriverResponseSchema : refreshAdminResponseSchema
              ),
            },
          },
        },
        401: unauthenticated,
      },
    });

    // POST /{role}/auth/logout
    registry.registerPath({
      method: 'post',
      path: `/${role}/auth/logout`,
      tags,
      summary: `Logout ${role}`,
      request: { body: { content: { 'application/json': { schema: logoutSchema } } } },
      responses: {
        200: {
          description: 'Logged out',
          content: {
            'application/json': { schema: successResponse(logoutResponseSchema) },
          },
        },
      },
    });
  }

  // POST /driver/profile/picture-upload-url
  registry.registerPath({
    method: 'post',
    path: `/driver/profile/picture-upload-url`,
    tags: ['Driver'],
    summary: 'Request profile picture upload URL',
    security: bearerAuth,
    responses: {
      200: {
        description: 'Upload authorised',
        content: {
          'application/json': { schema: successResponse(requestProfilePictureUploadResponseSchema) },
        },
      },
      401: unauthenticated,
    },
  });

  // ─── Admin Driver Routes ─────────────────────────────────────────────────────────────────────

  const adminTags = ['Admin-Drivers'];

  // GET /admin/drivers
  registry.registerPath({
    method: 'get',
    path: '/admin/drivers',
    tags: adminTags,
    summary: 'List drivers',
    security: bearerAuth,
    request: { query: adminDriverListQuerySchema },
    responses: {
      200: { description: 'Drivers listed', content: { 'application/json': { schema: successResponse(adminDriverListResponseSchema) } } },
      401: unauthenticated,
    },
  });

  // GET /admin/drivers/{id}
  registry.registerPath({
    method: 'get',
    path: '/admin/drivers/{id}',
    tags: adminTags,
    summary: 'Get driver details',
    security: bearerAuth,
    request: { params: driverIdParamSchema },
    responses: {
      200: { description: 'Driver details', content: { 'application/json': { schema: successResponse(adminDriverDetailsResponseSchema) } } },
      401: unauthenticated,
      404: { description: 'Driver not found', ...jsonError },
    },
  });

  // GET /admin/drivers/{id}/wallet
  registry.registerPath({
    method: 'get',
    path: '/admin/drivers/{id}/wallet',
    tags: adminTags,
    summary: 'Get driver wallet details and ledger',
    security: bearerAuth,
    request: { params: driverIdParamSchema },
    responses: {
      200: { description: 'Driver wallet', content: { 'application/json': { schema: successResponse(adminDriverWalletDetailsResponseSchema) } } },
      401: unauthenticated,
      404: { description: 'Driver not found', ...jsonError },
    },
  });

  // GET /admin/drivers/{id}/duty-history
  registry.registerPath({
    method: 'get',
    path: '/admin/drivers/{id}/duty-history',
    tags: adminTags,
    summary: 'Get driver duty history sessions',
    security: bearerAuth,
    request: { params: driverIdParamSchema },
    responses: {
      200: { description: 'Driver duty history', content: { 'application/json': { schema: successResponse(adminDriverDutyHistoryResponseSchema) } } },
      401: unauthenticated,
      404: { description: 'Driver not found', ...jsonError },
    },
  });

  // POST /admin/drivers/{id}/approve
  registry.registerPath({
    method: 'post',
    path: '/admin/drivers/{id}/approve',
    tags: adminTags,
    summary: 'Approve driver',
    security: bearerAuth,
    request: { params: driverIdParamSchema },
    responses: {
      200: { description: 'Driver approved', content: { 'application/json': { schema: successResponse(approveDriverResponseSchema) } } },
      401: unauthenticated,
    },
  });

  // POST /admin/drivers/{id}/reject
  registry.registerPath({
    method: 'post',
    path: '/admin/drivers/{id}/reject',
    tags: adminTags,
    summary: 'Reject driver',
    security: bearerAuth,
    request: { params: driverIdParamSchema, body: { content: { 'application/json': { schema: rejectDriverSchema } } } },
    responses: {
      200: { description: 'Driver rejected', content: { 'application/json': { schema: successResponse(rejectDriverResponseSchema) } } },
      401: unauthenticated,
    },
  });

  // PATCH /admin/drivers/{id}/documents/{docId}
  registry.registerPath({
    method: 'patch',
    path: '/admin/drivers/{id}/documents/{docId}',
    tags: adminTags,
    summary: 'Review document',
    security: bearerAuth,
    request: {
      params: z.object({ id: z.string(), docId: z.string() }),
      body: { content: { 'application/json': { schema: reviewDocumentSchema } } },
    },
    responses: {
      200: { description: 'Document reviewed', content: { 'application/json': { schema: successResponse(reviewDocumentResponseSchema) } } },
      401: unauthenticated,
    },
  });

  // GET /admin/drivers/{id}/wallet
  registry.registerPath({
    method: 'get',
    path: '/admin/drivers/{id}/wallet',
    tags: adminTags,
    summary: 'Get driver wallet details and ledger',
    security: bearerAuth,
    request: { params: driverIdParamSchema },
    responses: {
      200: { description: 'Driver wallet', content: { 'application/json': { schema: successResponse(z.any()) } } },
      401: unauthenticated,
      404: { description: 'Driver not found', ...jsonError },
    },
  });

  // GET /admin/drivers/{id}/duty-history
  registry.registerPath({
    method: 'get',
    path: '/admin/drivers/{id}/duty-history',
    tags: adminTags,
    summary: 'Get driver duty history sessions',
    security: bearerAuth,
    request: { params: driverIdParamSchema },
    responses: {
      200: { description: 'Driver duty history', content: { 'application/json': { schema: successResponse(z.any()) } } },
      401: unauthenticated,
      404: { description: 'Driver not found', ...jsonError },
    },
  });

  // PATCH /admin/drivers/{id}/verify-hill
  registry.registerPath({
    method: 'patch',
    path: '/admin/drivers/{id}/verify-hill',
    tags: adminTags,
    summary: 'Verify driver for hill driving',
    security: bearerAuth,
    request: { params: driverIdParamSchema, body: { content: { 'application/json': { schema: verifyHillDrivingSchema } } } },
    responses: {
      200: { description: 'Hill driving verified', content: { 'application/json': { schema: successResponse(z.object({ can_drive_hill_verified: z.boolean() })) } } },
      401: unauthenticated,
    },
  });
}
