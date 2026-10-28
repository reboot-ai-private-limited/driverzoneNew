import type { GstInvoiceStatus } from '@driverzone/contracts';
import type { GstInvoiceRequest, NewGstInvoiceRequest } from './gstInvoice.entity.js';

export interface GstInvoiceRepositoryPort {
  /** Throws a duplicate-key error when the booking already has a request — see the unique index. */
  create(request: NewGstInvoiceRequest): Promise<GstInvoiceRequest>;
  findByBooking(bookingId: string): Promise<GstInvoiceRequest | null>;
  /** The customer's most recent request on any trip — what the next form pre-fills from. */
  findLatestForCustomer(customerId: string): Promise<GstInvoiceRequest | null>;
  /** Newest first, at most `limit`. */
  listForAdmin(filter: { status?: GstInvoiceStatus | undefined }, limit: number): Promise<GstInvoiceRequest[]>;
  /**
   * PENDING → SENT or REJECTED, once. Null when there is no such request or it was already
   * resolved — a second click from another admin must not overwrite the first answer.
   */
  resolve(
    id: string,
    resolution: {
      status: Exclude<GstInvoiceStatus, 'PENDING'>;
      invoiceNumber: string | null;
      adminNote: string | null;
      resolvedBy: string;
      resolvedAt: Date;
    },
  ): Promise<GstInvoiceRequest | null>;
}
