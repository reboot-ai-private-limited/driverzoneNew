import mongoose from 'mongoose';
import { logger } from '@/shared/logging/logger.js';
import { AuditLogModel } from '@/shared/db/auditLog.model.js';
import type { AuditEntry, AuditPort } from '../domain/audit.port.js';

/**
 * INFRASTRUCTURE — FAQ changes, recorded. Same shared collection and same never-throws posture as
 * `settings/infrastructure/audit.settings.ts`: an audit write failing must not roll back a save
 * the admin has already watched succeed.
 *
 * The row carries the whole list either side of the change, because that is the unit of change
 * here — and because `ReplaceFaqsUseCase` can delete an entry, it is the only record of text that
 * no longer exists anywhere.
 */
export class FaqAuditLog implements AuditPort {
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
