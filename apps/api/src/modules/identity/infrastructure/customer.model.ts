import mongoose, { Schema } from 'mongoose';

/**
 * INFRASTRUCTURE — the `customers` collection (docs/LLD/database-schema.md).
 *
 * The first Mongoose model in this repository, so it sets the pattern the other twelve modules
 * will copy:
 *
 *   - An `interface` for the document shape, so consumers get types without `mongoose.Document`
 *     leaking into the domain.
 *   - `mongoose.models.X ?? mongoose.model(...)` — registering the same name twice throws
 *     `OverwriteModelError`, which is easy to hit under `tsx watch` and in a test file that
 *     imports two modules touching the same collection.
 *   - Field names in camelCase here and snake_case on the wire; the controller maps between
 *     them. The database is not the API.
 *
 * Nothing in `domain/` may import this file — the schema must not own a domain shape. That is
 * machine-checked by `domain-imports-nothing-above-it` in `.dependency-cruiser.cjs`.
 */

export interface CustomerDoc {
  _id: mongoose.Types.ObjectId;
  phone: string;
  fullName?: string | null;
  dob?: Date | null;
  gender?: string | null;
  languagesKnown?: string[];
  alternatePhone?: string | null;
  emergencyContact?: { name?: string; phone?: string } | null;
  savedAddresses?: unknown[];
  vehicles?: unknown[];
  rating: number;
  ratingCount: number;
  fcmTokens?: string[];
  isBlocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<CustomerDoc>(
  {
    // Primary identity and the OTP target. Everything else may be absent forever — customer
    // profiles complete progressively (docs/LLD/user.md §Customer).
    // `unique: true` declares the index — a separate schema.index({phone:1},{unique:true})
    // would define the same one twice, which Mongoose warns about at startup.
    phone: { type: String, required: true, unique: true },

    fullName: { type: String, default: null },
    dob: { type: Date, default: null },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY', null], default: null },
    languagesKnown: { type: [String], default: [] },

    alternatePhone: { type: String, default: null },
    emergencyContact: {
      type: new Schema({ name: String, phone: String }, { _id: false }),
      default: null,
    },

    /**
     * `entryId` rather than Mongo's `_id`, and `_id: false` to stop a second identifier
     * existing alongside it.
     *
     * These lists are rewritten whole (the "only one default" invariant spans every element, so
     * a per-item update could interleave and leave two defaults set). A Mongo-generated `_id`
     * would be regenerated on every such rewrite, so an address id a client held would silently
     * stop resolving. An application-generated `adr_` id survives, and is self-describing when
     * it turns up pasted into a support ticket.
     */
    savedAddresses: {
      type: [
        new Schema(
          {
            entryId: { type: String, required: true },
            label: { type: String, enum: ['HOME', 'OFFICE', 'OTHER'], required: true },
            address: { type: String, required: true },
            point: { type: { type: String, enum: ['Point'] }, coordinates: [Number] },
            isDefault: { type: Boolean, default: false },
            isPreferredPickup: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    // The CUSTOMER's own car — the driver drives it, they do not supply one
    // (docs/LLD/open-questions.md Q5).
    vehicles: {
      type: [
        new Schema(
          {
            // Same `entryId` reasoning as savedAddresses above.
            entryId: { type: String, required: true },
            category: { type: String, required: true },
            plateNumber: { type: String, required: true },
            fuelType: { type: String, enum: ['PETROL', 'DIESEL', 'EV', 'CNG', null], default: null },
            isDefault: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    rating: { type: Number, default: 5.0 },
    ratingCount: { type: Number, default: 0 },

    /**
     * FCM tokens for this customer's handsets — ride-update push. An array on the document
     * rather than its own collection: a customer has one or two phones, the tokens are read only
     * on the notification path (which already has the customer id), and `$addToSet` keeps a
     * re-register from duplicating. Mirrors `driver.model.ts`.
     */
    fcmTokens: { type: [String], default: [] },

    isBlocked: { type: Boolean, default: false },
  },
  { timestamps: true },
);


export const CustomerModel =
  (mongoose.models['Customer'] as mongoose.Model<CustomerDoc> | undefined) ??
  mongoose.model<CustomerDoc>('Customer', customerSchema);
