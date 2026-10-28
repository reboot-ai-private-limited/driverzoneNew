import type { GstInvoiceStatus } from '@driverzone/contracts';

/**
 * DOMAIN — a customer's request for a GST invoice on one completed trip.
 *
 * A REQUEST, NOT AN INVOICE. The bill itself is made by the team outside this system; what is
 * stored here is what it must be made out to, where to send it, and the team's answer. One per
 * booking — a second request for the same trip is a conflict, not a second bill.
 */
export interface GstInvoiceRequest {
  id: string;
  bookingId: string;
  bookingReference: string;
  customerId: string;

  gstin: string;
  legalName: string;
  billingAddress: string;
  /** Read off the GSTIN's first two digits when the request was made. */
  stateName: string;
  pincode: string;
  /** E.164. At least one of the two is present. */
  sendToWhatsapp: string | null;
  sendToEmail: string | null;

  /** The trip's booked fare incl. GST, frozen at request time — see `AdminGstInvoiceRequestDto`. */
  fareTotalPaise: number;

  status: GstInvoiceStatus;
  invoiceNumber: string | null;
  adminNote: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export type NewGstInvoiceRequest = Omit<
  GstInvoiceRequest,
  'id' | 'status' | 'invoiceNumber' | 'adminNote' | 'resolvedBy' | 'resolvedAt' | 'createdAt'
>;
