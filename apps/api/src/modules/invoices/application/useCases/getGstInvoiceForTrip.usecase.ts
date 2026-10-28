import { AppError } from '@/shared/errors/AppError.js';
import type { BookingInvoiceContract } from '../../../bookings/bookings.public.js';
import type { GstInvoiceRequest } from '../../domain/gstInvoice.entity.js';
import type { GstInvoiceRepositoryPort } from '../../domain/gstInvoiceRepository.port.js';

/**
 * What the ride-details screen needs in one call: this trip's request, if any, and — when there is
 * none — the customer's most recent request on any trip, so the form starts filled in.
 */
export class GetGstInvoiceForTripUseCase {
  constructor(
    private readonly repo: GstInvoiceRepositoryPort,
    private readonly bookings: BookingInvoiceContract,
  ) {}

  async execute(input: {
    customerId: string;
    bookingId: string;
  }): Promise<{ request: GstInvoiceRequest | null; prefill: GstInvoiceRequest | null }> {
    const booking = await this.bookings.findById(input.bookingId);
    if (booking === null || booking.customerId !== input.customerId) {
      throw AppError.notFound('That trip does not exist.');
    }

    const request = await this.repo.findByBooking(booking.id);
    if (request !== null) return { request, prefill: null };

    return { request: null, prefill: await this.repo.findLatestForCustomer(input.customerId) };
  }
}
