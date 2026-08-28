import mongoose from 'mongoose';
import type { SettingOverride } from '../domain/setting.entity.js';
import type { SettingRepositoryPort, SettingWrite } from '../domain/setting.repository.port.js';
import { GlobalSettingModel, type GlobalSettingDoc } from './setting.model.js';

/** INFRASTRUCTURE — the `globalSettings` collection. */

function toOverride(doc: GlobalSettingDoc): SettingOverride {
  return {
    id: String(doc._id),
    key: doc.key,
    value: doc.value,
    updatedBy: doc.updatedBy ? String(doc.updatedBy) : null,
    updatedAt: doc.updatedAt,
  };
}

export class MongoSettingRepository implements SettingRepositoryPort {
  async findOverrides(): Promise<SettingOverride[]> {
    const docs = await GlobalSettingModel.find().lean<GlobalSettingDoc[]>();
    return docs.map(toOverride);
  }

  /**
   * One upsert per key rather than a `bulkWrite`, and deliberately so: `bulkWrite` would not hand
   * back the resulting documents, and the audit entry needs each row's `_id`. Nineteen keys is
   * the ceiling on this loop.
   *
   * Not wrapped in a transaction. The use case has already validated every value and checked the
   * merged snapshot, so the only way a write here fails is the database being unreachable — in
   * which case a partial application is the same partial application a rolled-back transaction
   * would leave the operator re-applying by hand, and the cross-key invariants are re-checked on
   * the next write anyway.
   */
  async putMany(writes: readonly SettingWrite[], updatedBy: string): Promise<SettingOverride[]> {
    const adminId = new mongoose.Types.ObjectId(updatedBy);
    const results: SettingOverride[] = [];

    for (const write of writes) {
      const doc = await GlobalSettingModel.findOneAndUpdate(
        { key: write.key },
        { $set: { value: write.value, updatedBy: adminId } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean<GlobalSettingDoc>();
      results.push(toOverride(doc));
    }

    return results;
  }

  /** Reads before deleting: the caller audits what the value WAS, which is the interesting half. */
  async deleteMany(keys: readonly string[]): Promise<SettingOverride[]> {
    const docs = await GlobalSettingModel.find({ key: { $in: keys } }).lean<GlobalSettingDoc[]>();
    if (docs.length === 0) return [];
    await GlobalSettingModel.deleteMany({ key: { $in: docs.map((d) => d.key) } });
    return docs.map(toOverride);
  }
}
