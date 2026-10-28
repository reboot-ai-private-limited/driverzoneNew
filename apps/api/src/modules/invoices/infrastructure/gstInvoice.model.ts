import mongoose, { Schema } from 'mongoose';
import { GST_INVOICE_STATUSES } from '@driverzone/contracts';

/**
 * INFRASTRUCTURE — the `gstinvoicerequests` collection. One row per booking a customer asked a
 * GST invoice for.
 */
export interface GstInvoiceRequestDoc {
  _id: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  bookingReference: string;
  customerId: mongoose.Types.ObjectId;

  gstin: string;
  legalName: string;
  billingAddress: string;
  stateName: string;
  pincode: string;
  sendToWhatsapp: string | null;
  sendToEmail: string | null;

  fareTotalPaise: number;

  status: (typeof GST_INVOICE_STATUSES)[number];
  invoiceNumber: string | null;
  adminNote: string | null;
  resolvedBy: mongoose.Types.ObjectId | null;
  resolvedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const gstInvoiceRequestSchema = new Schema<GstInvoiceRequestDoc>(
  {
    bookingId: { type: Schema.Types.ObjectId, required: true },
    bookingReference: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, required: true },

    gstin: { type: String, required: true },
    legalName: { type: String, required: true },
    billingAddress: { type: String, required: true },
    stateName: { type: String, required: true },
    pincode: { type: String, required: true },
    sendToWhatsapp: { type: String, default: null },
    sendToEmail: { type: String, default: null },

    fareTotalPaise: { type: Number, required: true, min: 0 },

    status: { type: String, enum: GST_INVOICE_STATUSES, default: 'PENDING' },
    invoiceNumber: { type: String, default: null },
    adminNote: { type: String, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One request per trip. The real guarantee against a double-tapped submit; the use case only
// translates the duplicate-key error into a 409.
gstInvoiceRequestSchema.index({ bookingId: 1 }, { unique: true });

// The form's pre-fill: this customer's most recent request.
gstInvoiceRequestSchema.index({ customerId: 1, createdAt: -1 });

// The admin queue, filtered by status and newest first.
gstInvoiceRequestSchema.index({ status: 1, createdAt: -1 });

export const GstInvoiceRequestModel =
  (mongoose.models['GstInvoiceRequest'] as mongoose.Model<GstInvoiceRequestDoc> | undefined) ??
  mongoose.model<GstInvoiceRequestDoc>('GstInvoiceRequest', gstInvoiceRequestSchema);
