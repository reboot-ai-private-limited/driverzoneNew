import mongoose from 'mongoose';
import { logger } from '@/shared/logging/logger.js';
import { AuditLogModel } from '@/shared/db/auditLog.model.js';
import type { AuditEntry, AuditPort } from '../domain/audit.port.js';

/**
 * INFRASTRUCTURE — zone admin actions, recorded. Same shared collection and same never-throws
 * posture as `identity/infrastructure/audit.mongo.ts` — see that file's header for why an audit
 * write failing must not roll back the zone change the admin already watched succeed.
 */
export class ZonesAuditLog implements AuditPort {
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
