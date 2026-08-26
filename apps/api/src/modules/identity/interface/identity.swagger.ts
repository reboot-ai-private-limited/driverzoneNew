import { z } from 'zod';
import { errorResponse, registry, successResponse } from '@/shared/http/swagger.util.js';
import {
  otpSendSchema,
  otpVerifySchema,
  refreshSchema,
  logoutSchema,
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
}
