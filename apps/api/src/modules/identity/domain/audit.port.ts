import type { AuditAction } from '@/shared/db/auditLog.model.js';

/**
 * PORT — the record of what an admin did.
 *
 * `architecture.md` requires every admin action to be audited, and this module's admin
 * endpoints are the first that mutate anything. The entry shape matches the `auditLog`
 * collection in docs/LLD/database-schema.md — `AuditAction` is defined once, in `shared/`,
 * since `zones` needs the identical set of actions and a module cannot reach into another
 * module's `domain/` to reuse a type it defined locally.
 *
 * `APPROVE` and `REJECT` are distinct actions rather than `UPDATE`s. "Who approved this driver,
 * and when" is the question this collection exists to answer, and answering it should not
 * require reading `after` to tell an approval from an edit to a phone number.
 */
export type { AuditAction };

export interface AuditEntry {
  adminId: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  /**
   * State either side of the change. Both optional — a create has no `before` — and both should
   * carry only the fields that actually changed rather than whole documents, which would put a
   * copy of every driver's PII into a second collection with a different retention story.
   */
  before?: unknown;
  after?: unknown;
  ip?: string | undefined;
}

export interface AuditPort {
  /**
   * Records one admin action.
   *
   * **Must not throw into the caller's path.** An audit write failing is serious and is logged
   * as such, but it must not roll back an approval the admin already saw succeed — that would
   * turn a logging outage into an operations outage. The adapter absorbs and logs.
   */
  record(entry: AuditEntry): Promise<void>;
}
