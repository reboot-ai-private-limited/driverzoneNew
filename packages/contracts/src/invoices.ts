import type { Money } from './http.js';

/**
 * GST INVOICE REQUESTS (2026-10-28).
 *
 * A customer asks for a GST invoice for ONE completed trip; the team makes the bill outside the
 * system and marks the request sent. Nothing here generates an invoice — it is a request queue
 * with the billing details the bill needs, and the answer the team gives back.
 */

export const GST_INVOICE_STATUSES = ['PENDING', 'SENT', 'REJECTED'] as const;
export type GstInvoiceStatus = (typeof GST_INVOICE_STATUSES)[number];

/**
 * The GST state codes — the first two digits of every GSTIN. The state is never asked for
 * separately: it is read off the GSTIN, so the two cannot disagree.
 */
export const GST_STATE_CODES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

/**
 * A GSTIN's shape: 2-digit state code, 10-character PAN, entity number, `Z`, check character.
 * Shape only — the check character is not verified, and nothing here asks the GST portal.
 */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The state a GSTIN belongs to, or null when the shape or the state code is wrong. */
export function gstStateOf(gstin: string): string | null {
  const value = gstin.trim().toUpperCase();
  if (!GSTIN_PATTERN.test(value)) return null;
  return GST_STATE_CODES[value.slice(0, 2)] ?? null;
}

/** `POST /customer/bookings/:id/gst-invoice`. At least one of the two `send_to_*` is required. */
export interface CreateGstInvoiceRequest {
  gstin: string;
  legal_name: string;
  billing_address: string;
  /** Six digits. */
  pincode: string;
  /** E.164, e.g. `+919876543210`. */
  send_to_whatsapp?: string | undefined;
  send_to_email?: string | undefined;
}

/** The details a bill is made out to — what the form pre-fills from the customer's last request. */
export interface GstBillingDetailsDto {
  gstin: string;
  legal_name: string;
  billing_address: string;
  pincode: string;
  send_to_whatsapp: string | null;
  send_to_email: string | null;
}

export interface GstInvoiceRequestDto extends GstBillingDetailsDto {
  id: string;
  booking_id: string;
  booking_reference: string;
  /** Read off the GSTIN — see `GST_STATE_CODES`. */
  state_name: string;
  status: GstInvoiceStatus;
  /** The team's invoice number, once sent. */
  invoice_number: string | null;
  /** The team's note — why it was rejected, or anything the customer should know. */
  admin_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

/**
 * `GET /customer/bookings/:id/gst-invoice` — this trip's request if there is one, and the details
 * to pre-fill the form with if there is not (from the customer's most recent request on any trip).
 */
export interface CustomerGstInvoiceResponse {
  request: GstInvoiceRequestDto | null;
  prefill: GstBillingDetailsDto | null;
}

/** One row of `GET /admin/gst-invoices`. */
export interface AdminGstInvoiceRequestDto extends GstInvoiceRequestDto {
  customer: { id: string; name: string | null; phone: string | null };
  /**
   * The trip's fare as booked (incl. GST), frozen when the request was made. Not the final
   * payable — waiting or an extra day are on the booking page, which the panel links to.
   */
  fare_total: Money;
}

/** `PATCH /admin/gst-invoices/:id`. */
export interface ResolveGstInvoiceRequest {
  status: Exclude<GstInvoiceStatus, 'PENDING'>;
  invoice_number?: string | undefined;
  note?: string | undefined;
}
