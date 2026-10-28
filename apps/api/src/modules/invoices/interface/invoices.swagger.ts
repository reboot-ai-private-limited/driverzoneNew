import { z } from 'zod';
import { GST_INVOICE_STATUSES } from '@driverzone/contracts';
import { bearerAuth, errorResponse, registry, successResponse } from '@/shared/http/swagger.util.js';
import { createGstInvoiceSchema, resolveGstInvoiceSchema } from './invoices.validation.js';

// ─── Response DTOs ──────────────────────────────────────────────────────────────────────────

const BillingDetails = z.object({
  gstin: z.string(),
  legal_name: z.string(),
  billing_address: z.string(),
  pincode: z.string(),
  send_to_whatsapp: z.string().nullable(),
  send_to_email: z.string().nullable(),
});

const GstInvoiceRequest = BillingDetails.extend({
  id: z.string(),
  booking_id: z.string(),
  booking_reference: z.string(),
  state_name: z.string(),
  status: z.enum(GST_INVOICE_STATUSES),
  invoice_number: z.string().nullable(),
  admin_note: z.string().nullable(),
  created_at: z.string().datetime(),
  resolved_at: z.string().datetime().nullable(),
});

const AdminGstInvoiceRequest = GstInvoiceRequest.extend({
  customer: z.object({ id: z.string(), name: z.string().nullable(), phone: z.string().nullable() }),
  fare_total: z.object({ amount_paise: z.number(), amount_display: z.string() }),
});

const CustomerGstInvoiceResponse = z.object({
  request: GstInvoiceRequest.nullable(),
  prefill: BillingDetails.nullable(),
});

// ─── Shared error entries ───────────────────────────────────────────────────────────────────

const jsonError = { content: { 'application/json': { schema: errorResponse } } };
const badRequest = { description: 'Invalid input', ...jsonError };
const notFound = { description: 'Not your trip, or no such request', ...jsonError };
const bookingParam = z.object({ id: z.string().openapi({ description: 'Booking ID' }) });

// ─── Registration ───────────────────────────────────────────────────────────────────────────

export function registerInvoicesSwaggerPaths(): void {
  registry.registerPath({
    method: 'get',
    path: '/v1/customer/bookings/{id}/gst-invoice',
    tags: ['Customer'],
    summary: "This trip's GST invoice request, and the details to pre-fill a new one with",
    security: bearerAuth,
    request: { params: bookingParam },
    responses: {
      200: {
        description: 'The request (or null) and a pre-fill (or null)',
        content: { 'application/json': { schema: successResponse(CustomerGstInvoiceResponse) } },
      },
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/customer/bookings/{id}/gst-invoice',
    tags: ['Customer'],
    summary: 'Request a GST invoice for a completed trip',
    security: bearerAuth,
    request: {
      params: bookingParam,
      body: { content: { 'application/json': { schema: createGstInvoiceSchema } } },
    },
    responses: {
      201: {
        description: 'Request received',
        content: { 'application/json': { schema: successResponse(GstInvoiceRequest) } },
      },
      400: badRequest,
      403: { description: 'The trip is not complete', ...jsonError },
      404: notFound,
      409: { description: 'Already requested for this trip', ...jsonError },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/admin/gst-invoices',
    tags: ['Admin'],
    summary: 'The GST invoice request queue, newest first',
    security: bearerAuth,
    request: { query: z.object({ status: z.enum(GST_INVOICE_STATUSES).optional() }) },
    responses: {
      200: {
        description: 'Up to 200 requests',
        content: { 'application/json': { schema: successResponse(z.array(AdminGstInvoiceRequest)) } },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/v1/admin/gst-invoices/{id}',
    tags: ['Admin'],
    summary: 'Mark a GST invoice request sent, or reject it',
    security: bearerAuth,
    request: {
      params: z.object({ id: z.string().openapi({ description: 'Request ID' }) }),
      body: { content: { 'application/json': { schema: resolveGstInvoiceSchema } } },
    },
    responses: {
      200: {
        description: 'Answered',
        content: { 'application/json': { schema: successResponse(AdminGstInvoiceRequest) } },
      },
      400: badRequest,
      409: { description: 'No such request, or already answered', ...jsonError },
    },
  });
}
