import { z } from 'zod';
import { GST_INVOICE_STATUSES, GSTIN_PATTERN } from '@driverzone/contracts';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Not a valid id.');
export const idParam = z.object({ id: objectId });

/*
 * Optional strings arrive as `""` from a form left blank. Treated as absent, so "at least one of
 * WhatsApp or email" is decided by the use case on what was actually given.
 */
const optionalText = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());

export const createGstInvoiceSchema = z
  .object({
    gstin: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(GSTIN_PATTERN, 'Enter a valid 15-character GSTIN, e.g. 19ABCDE1234F1Z5')),
    legal_name: z.string().trim().min(1).max(120),
    billing_address: z.string().trim().min(5).max(500),
    pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit pincode'),
    // E.164, the rule every other number in this API follows.
    send_to_whatsapp: optionalText(
      z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Enter the WhatsApp number in international format, e.g. +919876543210'),
    ),
    send_to_email: optionalText(z.string().trim().email('Enter a valid email address').max(120)),
  })
  .strict();

export const adminListQuery = z.object({
  status: z.enum(GST_INVOICE_STATUSES).optional(),
});

export const resolveGstInvoiceSchema = z
  .object({
    status: z.enum(['SENT', 'REJECTED']),
    invoice_number: z.string().trim().max(60).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
