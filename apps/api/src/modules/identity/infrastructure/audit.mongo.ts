import mongoose from 'mongoose';
import { logger } from '@/shared/logging/logger.js';
import type { AuditEntry, AuditPort } from '../domain/audit.port.js';
import { AuditLogModel } from './auditLog.model.js';

/**
 * INFRASTRUCTURE — admin actions, recorded.
 *
 * **Never throws into the caller.** An audit write failing is serious and is logged at `error`,
 * but it must not roll back an approval the admin already watched succeed — that would turn a
 * logging problem into an operations outage, and would leave the driver approved anyway if the
 * failure happened after the main write.
 *
 * The honest cost: a dropped audit entry is invisible to the actor. That is the right trade for
 * an availability-critical path, and it is why the failure is logged loudly enough to alert on.
 */
export class MongoAuditLog implements AuditPort {
  async record(entry: AuditEntry): Promise<void> {
    try {
      await AuditLogModel.create({
        adminId: new mongoose.Types.ObjectId(entry.adminId),
        entityType: entry.entityType,
        entityId: new mongoose.Types.ObjectId(entry.entityId),
        action: entry.action,
        before: entry.before,
        after: entry.after,
        ip: entry.ip ?? null,
      });
    } catch (err) {
      logger.error(
        {
          entityType: entry.entityType,
          entityId: entry.entityId,
          action: entry.action,
          err: err instanceof Error ? err.message : String(err),
        },
        'audit write failed',
      );
    }
  }
}
