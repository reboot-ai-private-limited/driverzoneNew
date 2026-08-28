import mongoose from 'mongoose';
import { logger } from '@/shared/logging/logger.js';
import { AuditLogModel } from '@/shared/db/auditLog.model.js';
import type { AuditEntry, AuditPort } from '../domain/audit.port.js';

/**
 * INFRASTRUCTURE — global settings changes, recorded. Same shared collection and same never-throws
 * posture as `zones/infrastructure/audit.zones.ts` — an audit write failing must not roll back
 * a settings change the admin has already watched succeed.
 *
 * `entityId` is the override document's `_id`, not the key: `auditLog.entityId` is an ObjectId,
 * and the key is carried in `before`/`after` instead. That means a reset-to-default writes its
 * audit row against an id that no longer exists, which is correct — the row is the record that
 * it USED to.
 */
export class SettingsAuditLog implements AuditPort {
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
