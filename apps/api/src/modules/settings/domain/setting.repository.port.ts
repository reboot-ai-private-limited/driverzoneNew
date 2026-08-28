import type { SettingOverride } from './setting.entity.js';

/**
 * PORT — the `globalSettings` collection, as this module needs it.
 *
 * Only overrides cross this boundary; defaults are code and never touch the database. There is
 * deliberately no `findOne(key)`: the read path always wants the whole map (it is nineteen small
 * documents and it is cached), and a per-key read is how you end up with N round trips inside a
 * fare calculation.
 *
 * Both writes return the affected rows rather than a count, because the audit entry needs each
 * row's `_id` — `auditLog.entityId` is an ObjectId, so a settings audit is anchored to the
 * override document, with the key itself carried in the payload.
 */
export interface SettingWrite {
  key: string;
  value: unknown;
}

export interface SettingRepositoryPort {
  /** Every stored override. Absent keys are at their default — that is not an error condition. */
  findOverrides(): Promise<SettingOverride[]>;
  /** Upsert, one row per key. Returns the rows as they now stand. */
  putMany(writes: readonly SettingWrite[], updatedBy: string): Promise<SettingOverride[]>;
  /** Removes overrides so the defaults take over. Returns the rows as they were before removal. */
  deleteMany(keys: readonly string[]): Promise<SettingOverride[]>;
}
