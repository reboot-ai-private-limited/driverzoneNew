import mongoose from 'mongoose';
import type { GstInvoiceStatus } from '@driverzone/contracts';
import type { GstInvoiceRequest, NewGstInvoiceRequest } from '../domain/gstInvoice.entity.js';
import type { GstInvoiceRepositoryPort } from '../domain/gstInvoiceRepository.port.js';
import { GstInvoiceRequestModel, type GstInvoiceRequestDoc } from './gstInvoice.model.js';

function toEntity(doc: GstInvoiceRequestDoc): GstInvoiceRequest {
  return {
    id: String(doc._id),
    bookingId: String(doc.bookingId),
    bookingReference: doc.bookingReference,
    customerId: String(doc.customerId),
    gstin: doc.gstin,
    legalName: doc.legalName,
    billingAddress: doc.billingAddress,
    stateName: doc.stateName,
    pincode: doc.pincode,
    sendToWhatsapp: doc.sendToWhatsapp ?? null,
    sendToEmail: doc.sendToEmail ?? null,
    fareTotalPaise: doc.fareTotalPaise,
    status: doc.status,
    invoiceNumber: doc.invoiceNumber ?? null,
    adminNote: doc.adminNote ?? null,
    resolvedBy: doc.resolvedBy === null || doc.resolvedBy === undefined ? null : String(doc.resolvedBy),
    resolvedAt: doc.resolvedAt ?? null,
    createdAt: doc.createdAt,
  };
}

export class MongoGstInvoiceRepository implements GstInvoiceRepositoryPort {
  async create(request: NewGstInvoiceRequest): Promise<GstInvoiceRequest> {
    const doc = await GstInvoiceRequestModel.create({
      ...request,
      bookingId: new mongoose.Types.ObjectId(request.bookingId),
      customerId: new mongoose.Types.ObjectId(request.customerId),
    });
    return toEntity(doc.toObject());
  }

  async findByBooking(bookingId: string): Promise<GstInvoiceRequest | null> {
    if (!mongoose.isValidObjectId(bookingId)) return null;
    const doc = await GstInvoiceRequestModel.findOne({ bookingId }).lean<GstInvoiceRequestDoc>().exec();
    return doc === null ? null : toEntity(doc);
  }

  async findLatestForCustomer(customerId: string): Promise<GstInvoiceRequest | null> {
    if (!mongoose.isValidObjectId(customerId)) return null;
    const doc = await GstInvoiceRequestModel.findOne({ customerId })
      .sort({ createdAt: -1 })
      .lean<GstInvoiceRequestDoc>()
      .exec();
    return doc === null ? null : toEntity(doc);
  }

  async listForAdmin(
    filter: { status?: GstInvoiceStatus | undefined },
    limit: number,
  ): Promise<GstInvoiceRequest[]> {
    const docs = await GstInvoiceRequestModel.find(filter.status === undefined ? {} : { status: filter.status })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<GstInvoiceRequestDoc[]>()
      .exec();
    return docs.map(toEntity);
  }

  async resolve(
    id: string,
    resolution: {
      status: Exclude<GstInvoiceStatus, 'PENDING'>;
      invoiceNumber: string | null;
      adminNote: string | null;
      resolvedBy: string;
      resolvedAt: Date;
    },
  ): Promise<GstInvoiceRequest | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    // Guarded on PENDING so two admins answering at once cannot both win.
    const doc = await GstInvoiceRequestModel.findOneAndUpdate(
      { _id: id, status: 'PENDING' },
      {
        $set: {
          ...resolution,
          resolvedBy: mongoose.isValidObjectId(resolution.resolvedBy)
            ? new mongoose.Types.ObjectId(resolution.resolvedBy)
            : null,
        },
      },
      { new: true },
    )
      .lean<GstInvoiceRequestDoc>()
      .exec();
    return doc === null ? null : toEntity(doc);
  }
}
