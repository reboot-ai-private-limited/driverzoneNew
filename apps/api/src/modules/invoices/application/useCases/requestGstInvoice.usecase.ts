import { gstStateOf } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import type { BookingInvoiceContract } from '../../../bookings/bookings.public.js';
import type { GstInvoiceRequest } from '../../domain/gstInvoice.entity.js';
import type { GstInvoiceRepositoryPort } from '../../domain/gstInvoiceRepository.port.js';

export interface RequestGstInvoiceInput {
  customerId: string;
  bookingId: string;
  gstin: string;
  legalName: string;
  billingAddress: string;
  pincode: string;
  sendToWhatsapp?: string | undefined;
  sendToEmail?: string | undefined;
}

/**
 * A customer asks for a GST invoice on one of their own COMPLETED trips.
 *
 * Who is asking comes from the token; whose trip it is comes from the booking — so a customer
 * cannot file a request against somebody else's trip, and a 404 (not 403) keeps "that trip
 * exists" from leaking. The state is read off the GSTIN, never asked for.
 */
export class RequestGstInvoiceUseCase {
  constructor(
    private readonly repo: GstInvoiceRepositoryPort,
    private readonly bookings: BookingInvoiceContract,
  ) {}

  async execute(input: RequestGstInvoiceInput): Promise<GstInvoiceRequest> {
    const booking = await this.bookings.findById(input.bookingId);
    if (booking === null || booking.customerId !== input.customerId) {
      throw AppError.notFound('That trip does not exist.');
    }
    if (booking.status !== 'COMPLETED') {
      throw AppError.forbidden('A GST invoice can be requested once the trip is complete.');
    }

    const gstin = input.gstin.trim().toUpperCase();
    const stateName = gstStateOf(gstin);
    // The validation layer already checked the shape; this is the state code, which it cannot.
    if (stateName === null) throw AppError.badRequest('That GSTIN does not have a valid state code.');

    const sendToWhatsapp = blankToNull(input.sendToWhatsapp);
    const sendToEmail = blankToNull(input.sendToEmail)?.toLowerCase() ?? null;
    if (sendToWhatsapp === null && sendToEmail === null) {
      throw AppError.badRequest('Add a WhatsApp number or an email address to send the invoice to.');
    }

    const existing = await this.repo.findByBooking(booking.id);
    if (existing !== null) throw AppError.conflict('A GST invoice has already been requested for this trip.');

    try {
      return await this.repo.create({
        bookingId: booking.id,
        bookingReference: booking.reference,
        customerId: input.customerId,
        gstin,
        legalName: input.legalName.trim(),
        billingAddress: input.billingAddress.trim(),
        stateName,
        pincode: input.pincode.trim(),
        sendToWhatsapp,
        sendToEmail,
        fareTotalPaise: booking.fareSnapshot.fare.totalPaise,
      });
    } catch (error) {
      // The `{ bookingId }` unique index, firing on a double-tapped submit that both read
      // "no request yet" above. The index is the real guarantee; this only translates it.
      if (isDuplicateKey(error)) {
        throw AppError.conflict('A GST invoice has already been requested for this trip.');
      }
      throw error;
    }
  }
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
