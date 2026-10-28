import type { GstInvoiceStatus } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import type { GstInvoiceRequest } from '../../domain/gstInvoice.entity.js';
import type { GstInvoiceRepositoryPort } from '../../domain/gstInvoiceRepository.port.js';

/**
 * The team's answer: the invoice was sent, or the request was rejected.
 *
 * A rejection must say why — the customer reads that note, and "rejected" alone tells them nothing
 * they can fix. Answering is once only: a request already answered is a 409, so a second admin
 * cannot silently overwrite the first one's invoice number.
 */
export class ResolveGstInvoiceUseCase {
  constructor(private readonly repo: GstInvoiceRepositoryPort) {}

  async execute(input: {
    id: string;
    adminId: string;
    status: Exclude<GstInvoiceStatus, 'PENDING'>;
    invoiceNumber?: string | undefined;
    note?: string | undefined;
  }): Promise<GstInvoiceRequest> {
    const invoiceNumber = input.invoiceNumber?.trim() || null;
    const adminNote = input.note?.trim() || null;
    if (input.status === 'REJECTED' && adminNote === null) {
      throw AppError.badRequest('Say why the request is being rejected — the customer sees this note.');
    }

    const resolved = await this.repo.resolve(input.id, {
      status: input.status,
      // An invoice number only means something on a sent invoice.
      invoiceNumber: input.status === 'SENT' ? invoiceNumber : null,
      adminNote,
      resolvedBy: input.adminId,
      resolvedAt: new Date(),
    });
    if (resolved !== null) return resolved;

    throw AppError.conflict('That request does not exist or has already been answered.');
  }
}
