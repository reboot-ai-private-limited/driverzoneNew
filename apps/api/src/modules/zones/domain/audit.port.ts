import type { AuditAction } from '@/shared/db/auditLog.model.js';

/**
 * PORT — the record of what an admin did to a zone.
 *
 * Same shape as `identity/domain/audit.port.ts` on purpose — both write to the one shared
 * `auditLog` collection (`@/shared/db/auditLog.model.ts`) — but each module owns its own port
 * rather than importing the other's, since `module-internals-are-private` forbids reaching into
 * another module's `domain/` and a port is exactly the kind of thing each bounded context
 * declares for itself even when the adapter behind it is shared.
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
  /** Must not throw into the caller's path — see `identity/domain/audit.port.ts` for why. */
  record(entry: AuditEntry): Promise<void>;
}
