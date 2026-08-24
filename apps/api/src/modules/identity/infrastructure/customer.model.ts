import mongoose, { Schema } from 'mongoose';

/**
 * INFRASTRUCTURE — the `customers` collection (docs/LLD/03-database-schema.md).
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
  isBlocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<CustomerDoc>(
  {
    // Primary identity and the OTP target. Everything else may be absent forever — customer
    // profiles complete progressively (docs/LLD/13-auth-and-user.md §Customer).
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

    // Shapes land in phase 2 with the address/vehicle endpoints; declared now so `strictQuery`
    // does not reject a filter on them and so the collection shape matches the schema doc.
    savedAddresses: {
      type: [
        new Schema(
          {
            label: { type: String, enum: ['HOME', 'OFFICE', 'OTHER'], required: true },
            address: { type: String, required: true },
            point: { type: { type: String, enum: ['Point'] }, coordinates: [Number] },
            isDefault: { type: Boolean, default: false },
            isPreferredPickup: { type: Boolean, default: false },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    // The CUSTOMER's own car — the driver drives it, they do not supply one
    // (docs/LLD/12-open-questions.md Q5).
    vehicles: {
      type: [
        new Schema(
          {
            category: { type: String, required: true },
            plateNumber: { type: String, required: true },
            fuelType: { type: String, enum: ['PETROL', 'DIESEL', 'EV', 'CNG'] },
            isDefault: { type: Boolean, default: false },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    isBlocked: { type: Boolean, default: false },
  },
  { timestamps: true },
);


export const CustomerModel =
  (mongoose.models['Customer'] as mongoose.Model<CustomerDoc> | undefined) ??
  mongoose.model<CustomerDoc>('Customer', customerSchema);
