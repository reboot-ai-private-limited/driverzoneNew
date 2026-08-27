import { z } from 'zod';
import { bearerAuth, errorResponse, registry, successResponse } from '@/shared/http/swagger.util.js';
import {
  otpSendSchema,
  otpVerifySchema,
  refreshSchema,
  logoutSchema,
  adminDriverListQuerySchema,
  driverIdParamSchema,
  rejectDriverSchema,
  reviewDocumentSchema,
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
  vehicle_type_preference: z.enum(['AUTO', 'MANUAL', 'EV']).nullable(),
  vehicle_category_preference: z.array(z.string()),
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

const roles = ['customer', 'driver', 'admin'] as const;

export function registerIdentitySwaggerPaths(): void {
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
}
