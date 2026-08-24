import type { DocumentStatus } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { canReview } from '../../domain/driverOnboarding.entity.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type { DriverDocument, DriverDocumentRepositoryPort } from '../../domain/driverDocument.repository.port.js';
import type { DriverProfile, DriverProfileRepositoryPort } from '../../domain/driverProfile.repository.port.js';

export interface ActorContext {
  adminId: string;
  ip?: string | undefined;
}

/**
 * APPLICATION — the admin side of driver verification.
 *
 * Every method here writes an audit entry, because these are exactly the actions
 * `09-architecture.md` means by "admin actions all audited". Grouped into one class because all
 * three share the same actor context, the same audit shape, and the same "may an admin act on
 * this driver right now" question.
 */
export class VerifyDriverUseCase {
  constructor(
    private readonly drivers: DriverProfileRepositoryPort,
    private readonly documents: DriverDocumentRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  private async loadReviewable(driverId: string): Promise<DriverProfile> {
    const driver = await this.drivers.findById(driverId);
    if (driver === undefined) throw AppError.notFound('That driver could not be found.');

    /**
     * Only a SUBMITTED driver can be approved or rejected.
     *
     * Approving someone who never applied would bypass the completeness gate entirely — which
     * is the single thing that gate exists to prevent, and the reason it is checked here rather
     * than trusted to the admin panel's UI.
     */
    if (!canReview(driver.onboardingStatus)) {
      throw AppError.conflict('That driver has not submitted an application for review.', {
        onboarding_status: driver.onboardingStatus,
      });
    }

    return driver;
  }

  async approve(driverId: string, actor: ActorContext): Promise<DriverProfile> {
    const before = await this.loadReviewable(driverId);

    // ONE write sets onboardingStatus, isVerified, verifiedBy and verifiedAt together. Two
    // writes is how a driver ends up showing "approved" while dispatch still refuses them
    // (docs/LLD/03-database-schema.md).
    const after = await this.drivers.approve(driverId, actor.adminId, new Date());
    if (after === undefined) throw AppError.notFound('That driver could not be found.');

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'Driver',
      entityId: driverId,
      action: 'APPROVE',
      // Only the fields that changed, never whole documents — a copy of every driver's PII in a
      // second collection with a different retention story is a liability, not an audit trail.
      before: { onboardingStatus: before.onboardingStatus, isVerified: before.isVerified },
      after: { onboardingStatus: after.onboardingStatus, isVerified: after.isVerified },
      ip: actor.ip,
    });

    return after;
  }

  async reject(driverId: string, reason: string, actor: ActorContext): Promise<DriverProfile> {
    const before = await this.loadReviewable(driverId);

    const after = await this.drivers.setOnboardingStatus(driverId, 'REJECTED', reason);
    if (after === undefined) throw AppError.notFound('That driver could not be found.');

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'Driver',
      entityId: driverId,
      action: 'REJECT',
      before: { onboardingStatus: before.onboardingStatus },
      // The reason is part of the record: "why was this driver turned away" is a question that
      // gets asked weeks later, usually by someone who was not the admin who decided.
      after: { onboardingStatus: after.onboardingStatus, reason },
      ip: actor.ip,
    });

    return after;
  }

  /**
   * Per-document review, independent of the overall approval.
   *
   * A driver can have three verified documents and one rejected, and the app should say which —
   * so this deliberately does NOT touch `onboardingStatus`. An admin rejecting one document and
   * then rejecting the application is two decisions, and conflating them would silently reject
   * applications on the first bad photo.
   */
  async reviewDocument(
    documentId: string,
    status: DocumentStatus,
    reason: string | undefined,
    actor: ActorContext,
  ): Promise<DriverDocument> {
    const before = await this.documents.findById(documentId);
    if (before === undefined) throw AppError.notFound('That document could not be found.');

    // A rejection with no reason is unactionable — the driver re-uploads the same unreadable
    // photo and everyone's time is spent again.
    if (status === 'REJECTED' && (reason === undefined || reason.trim() === '')) {
      throw AppError.badRequest('Say why the document was rejected.', { field: 'reason' });
    }

    const after = await this.documents.review(
      documentId,
      status,
      status === 'REJECTED' ? (reason ?? null) : null,
      actor.adminId,
      new Date(),
    );
    if (after === undefined) throw AppError.notFound('That document could not be found.');

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'DriverDocument',
      entityId: documentId,
      action: status === 'VERIFIED' ? 'APPROVE' : status === 'REJECTED' ? 'REJECT' : 'UPDATE',
      before: { status: before.status },
      after: { status: after.status, ...(after.rejectionReason === null ? {} : { reason: after.rejectionReason }) },
      ip: actor.ip,
    });

    return after;
  }
}
