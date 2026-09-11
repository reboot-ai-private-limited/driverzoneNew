import mongoose, { Schema } from 'mongoose';

/**
 * INFRASTRUCTURE — the `customerFavouriteDrivers` collection.
 *
 * ITS OWN COLLECTION, NOT AN ARRAY ON `customers`, which is the pattern `savedAddresses` and
 * `vehicles` follow. Those two are rewritten whole because an invariant spans the whole list
 * ("only one default"), and a per-item update could interleave and break it. Favourites have no
 * such invariant: they are added and removed one at a time from four different screens, and a
 * whole-document rewrite would make two hearts tapped at once lose one of them. A unique index
 * gives idempotence for free, which is exactly what a heart wants.
 *
 * NO `updatedAt`. A favourite is created and deleted; there is nothing about one to update, so
 * the field would only ever repeat `createdAt`.
 */

export interface FavouriteDriverDoc {
  _id: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const favouriteDriverSchema = new Schema<FavouriteDriverDoc>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/**
 * One row per pair. This is what makes adding a favourite twice a no-op rather than a duplicate —
 * the repository catches the duplicate-key error and reports `added: false`, so the apps never
 * have to guard a double tap.
 */
favouriteDriverSchema.index({ customerId: 1, driverId: 1 }, { unique: true });

/** The list read, and dispatch's wave 0: this customer's favourites, newest first. */
favouriteDriverSchema.index({ customerId: 1, createdAt: -1 });

export const FavouriteDriverModel =
  (mongoose.models['FavouriteDriver'] as mongoose.Model<FavouriteDriverDoc> | undefined) ??
  mongoose.model<FavouriteDriverDoc>(
    'FavouriteDriver',
    favouriteDriverSchema,
    // Named explicitly rather than left to Mongoose's pluraliser, which would give
    // `favouritedrivers` — a collection name that reads as one word and does not say whose.
    'customerFavouriteDrivers',
  );
