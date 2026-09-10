import type { AuditAction } from '@/shared/db/auditLog.model.js';

/**
 * PORT — the record of what an admin changed in the FAQs.
 *
 * Same shape as `settings/domain/audit.port.ts`, and for the same reason: both write to the one
 * shared `auditLog` collection, but `module-internals-are-private` forbids reaching into another
 * module's `domain/`, and a port is the kind of thing each bounded context declares for itself
 * even when the adapter behind it is shared.
 */
export type { AuditAction };

export interface AuditEntry {
  adminId: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  /** State either side of the change. Both optional — a create has no `before`. */
  before?: unknown;
  after?: unknown;
  ip?: string | undefined;
}

export interface AuditPort {
  /** Must not throw into the caller's path — see `settings/domain/audit.port.ts` for why. */
  record(entry: AuditEntry): Promise<void>;
}
