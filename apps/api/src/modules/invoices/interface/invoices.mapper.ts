import type {
  AdminGstInvoiceRequestDto,
  GstBillingDetailsDto,
  GstInvoiceRequestDto,
} from '@driverzone/contracts';
import { toMoney } from '@/shared/money/format.js';
import type { CustomerContact } from '../../identity/identity.public.js';
import type { GstInvoiceRequest } from '../domain/gstInvoice.entity.js';

export function toBillingDetailsDto(request: GstInvoiceRequest): GstBillingDetailsDto {
  return {
    gstin: request.gstin,
    legal_name: request.legalName,
    billing_address: request.billingAddress,
    pincode: request.pincode,
    send_to_whatsapp: request.sendToWhatsapp,
    send_to_email: request.sendToEmail,
  };
}

export function toGstInvoiceRequestDto(request: GstInvoiceRequest): GstInvoiceRequestDto {
  return {
    ...toBillingDetailsDto(request),
    id: request.id,
    booking_id: request.bookingId,
    booking_reference: request.bookingReference,
    state_name: request.stateName,
    status: request.status,
    invoice_number: request.invoiceNumber,
    admin_note: request.adminNote,
    created_at: request.createdAt.toISOString(),
    resolved_at: request.resolvedAt?.toISOString() ?? null,
  };
}

export function toAdminGstInvoiceRequestDto(
  request: GstInvoiceRequest,
  contact: CustomerContact | undefined,
): AdminGstInvoiceRequestDto {
  return {
    ...toGstInvoiceRequestDto(request),
    customer: {
      id: request.customerId,
      name: contact?.fullName ?? null,
      phone: contact?.phone ?? null,
    },
    fare_total: toMoney(request.fareTotalPaise),
  };
}
