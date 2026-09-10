import type { AuditPort } from '../../domain/audit.port.js';
import { orderedForWrite, type FaqDraft, type FaqItem } from '../../domain/faq.entity.js';
import { faqNotFound } from '../../domain/faq.errors.js';
import type { FaqRepositoryPort } from '../../domain/faq.repository.port.js';
import type { ActorContext } from '../actorContext.js';

/**
 * APPLICATION — the only write path for FAQs.
 *
 * THE REQUEST IS THE WHOLE LIST, in the order it should read. Reordering is the ordinary edit
 * here and it moves every row at once, so a per-row surface would turn one drag into N requests
 * that can half-fail and leave the list in an order nobody chose. Sending it entire also means
 * a deletion needs no destructive route of its own: an id the admin dropped from the array is an
 * id they deleted.
 *
 * THAT IS ALSO ITS ONE SHARP EDGE. A stale page — an admin who opened the settings screen before
 * a colleague added two FAQs — would silently delete those two by sending a list that predates
 * them. The staleness check below is what stops the reverse case (editing a row that is already
 * gone), but it cannot see rows the client never knew about. The panel must therefore refetch
 * before it saves, and the audit row records the full before/after so a wrong save is at least
 * recoverable by hand.
 *
 * ORDER IS ASSIGNED HERE, NEVER SENT. See `orderedForWrite`.
 */
export class ReplaceFaqsUseCase {
  constructor(
    private readonly repo: FaqRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(drafts: readonly FaqDraft[], actor: ActorContext): Promise<FaqItem[]> {
    const before = await this.repo.findAll();

    /*
     * An id the collection does not have is REJECTED rather than treated as new. The two readings
     * are opposite: "create this" versus "I am editing a row someone else deleted". Minting a new
     * entry for it would resurrect deleted content under a different id and tell the admin
     * nothing, so the write fails whole and names the ids — the panel can then say which rows
     * went stale instead of "reload".
     */
    const known = new Set(before.map((faq) => faq.id));
    const missing = drafts
      .map((draft) => draft.id)
      .filter((id): id is string => id !== undefined && !known.has(id));
    if (missing.length > 0) throw faqNotFound(missing);

    const after = await this.repo.replaceAll(orderedForWrite(drafts), actor.adminId);

    /*
     * ONE AUDIT ROW FOR THE WHOLE LIST, not one per entry. The unit of change is the list — a
     * reorder touches every row and means one thing — and `before`/`after` carry it entire, which
     * is what makes a mistaken save reconstructable. `entityId` is the admin's own id: the shared
     * `auditLog.entityId` is an ObjectId and this change belongs to no single document.
     */
    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'Faq',
      entityId: actor.adminId,
      action: 'UPDATE',
      before,
      after,
      ip: actor.ip,
    });

    return after;
  }
}
