import mongoose, { Schema } from 'mongoose';

/**
 * INFRASTRUCTURE — the `globalSettings` collection (docs/LLD/database-schema.md).
 *
 * A row exists ONLY for an overridden key. Defaults live in `domain/setting.registry.ts`, so this
 * collection is empty on a fresh install and the API still answers with a complete config. That
 * is why there is no seed script: seeding would turn every default into a row that a later
 * default change silently fails to reach.
 *
 * `value` is `Mixed` because the registry holds numbers and time windows alike. Mongoose does no
 * validation of a Mixed field and that is fine — the registry's Zod schema is the only validator,
 * applied on the way in AND again on the way out (`resolveOne` in `domain/setting.entity.ts`),
 * so a row hand-edited in a Mongo shell cannot poison a fare.
 *
 * `description` from the LLD's original sketch is deliberately NOT stored: it is documentation,
 * it belongs with the code that gives the key meaning, and a copy in the database is a copy that
 * goes stale the first time the behaviour changes.
 */

export interface GlobalSettingDoc {
  _id: mongoose.Types.ObjectId;
  key: string;
  value: unknown;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const globalSettingSchema = new Schema<GlobalSettingDoc>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  },
  { timestamps: true },
);

export const GlobalSettingModel =
  (mongoose.models['GlobalSetting'] as mongoose.Model<GlobalSettingDoc> | undefined) ??
  mongoose.model<GlobalSettingDoc>('GlobalSetting', globalSettingSchema);
