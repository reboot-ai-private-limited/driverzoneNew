import type { AdminRole } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import type {
  AdminRosterEntry,
  AdminRosterRepositoryPort,
} from '../../domain/adminRoster.repository.port.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type { SessionRepositoryPort } from '../../domain/session.repository.port.js';
import { adminPhoneTaken } from '../../domain/identity.errors.js';

export interface AdminActor {
  adminId: string;
  ip?: string | undefined;
}

/**
 * APPLICATION — a SUPER_ADMIN managing who can sign in to the admin panel.
 *
 * This replaces "admins are provisioned out of band" (docs/decision-log.md, 2026-09-23). What
 * that rule protected still holds: the OTP flow never creates an admin, and an unknown admin
 * number is still sent nothing. The only new way in is a row written HERE, by someone who is
 * already a super admin, and every such write is audited.
 *
 * Who may call this is decided by the route (`requireSuperAdmin`), not here — the same split as
 * every other admin use case, where `requireAuth('ADMIN')` guards the router.
 *
 * NOTHING IS EVER DELETED. A deactivated admin keeps their row, so the audit log's `adminId`
 * always resolves to a name and reactivating them restores the same identity.
 */
export class ManageAdminsUseCase {
  constructor(
    private readonly roster: AdminRosterRepositoryPort,
    private readonly sessions: SessionRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  list(): Promise<AdminRosterEntry[]> {
    return this.roster.list();
  }

  async create(
    input: { phone: string; fullName: string; adminRole: AdminRole },
    actor: AdminActor,
  ): Promise<AdminRosterEntry> {
    // Checked first for a clear message; the unique index is what actually settles a race.
    if ((await this.roster.findByPhone(input.phone)) !== undefined) throw adminPhoneTaken();

    const created = await this.roster.create({ ...input, createdBy: actor.adminId });

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'AdminUser',
      entityId: created.id,
      action: 'CREATE',
      after: { phone: created.mobileNumber, fullName: created.fullName, adminRole: created.adminRole },
      ip: actor.ip,
    });

    return created;
  }

  async update(
    adminId: string,
    patch: { fullName?: string; adminRole?: AdminRole },
    actor: AdminActor,
  ): Promise<AdminRosterEntry> {
    const before = await this.mustFind(adminId);

    /*
     * Not your own role. A super admin demoting themselves by accident is the most likely way the
     * roster ends up with nobody who can fix it, and there is never a reason to need it: ask
     * another super admin. Your own NAME is fine — it is the same edit `/admin/profile` allows.
     */
    if (adminId === actor.adminId && patch.adminRole !== undefined && patch.adminRole !== before.adminRole) {
      throw AppError.forbidden('You cannot change your own role. Ask another super admin.');
    }

    const updated = await this.roster.changeGuarded(adminId, { ...patch, byAdminId: actor.adminId });
    if (updated === undefined) throw AppError.notFound('Admin not found.');

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'AdminUser',
      entityId: adminId,
      action: 'UPDATE',
      before: { fullName: before.fullName, adminRole: before.adminRole },
      after: { fullName: updated.fullName, adminRole: updated.adminRole },
      ip: actor.ip,
    });

    return updated;
  }

  async setActive(adminId: string, isActive: boolean, actor: AdminActor): Promise<AdminRosterEntry> {
    const before = await this.mustFind(adminId);

    if (adminId === actor.adminId) {
      throw AppError.forbidden('You cannot deactivate yourself. Ask another super admin.');
    }

    // Already in the requested state: nothing to write, nothing to audit.
    if (before.isActive === isActive) return before;

    const updated = await this.roster.changeGuarded(adminId, { isActive, byAdminId: actor.adminId });
    if (updated === undefined) throw AppError.notFound('Admin not found.');

    /*
     * Signed out everywhere. Refresh already refuses an inactive admin; revoking as well means
     * nothing is left to even try. What this cannot reach is an access token already issued:
     * `requireAuth` is a signature check with no database read, so that token keeps working on
     * ordinary admin routes until it expires, at most 15 minutes. The super-admin routes do
     * re-read the row (`requireSuperAdmin`), so the powerful ones stop immediately.
     */
    if (!isActive) await this.sessions.revokeAllForUser(adminId, 'ADMIN', new Date());

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'AdminUser',
      entityId: adminId,
      action: isActive ? 'ACTIVATE' : 'SUSPEND',
      before: { isActive: before.isActive },
      after: { isActive: updated.isActive },
      ip: actor.ip,
    });

    return updated;
  }

  private async mustFind(adminId: string): Promise<AdminRosterEntry> {
    const found = await this.roster.findById(adminId);
    if (found === undefined) throw AppError.notFound('Admin not found.');
    return found;
  }
}
