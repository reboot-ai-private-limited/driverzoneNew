import type { FaqItem, OrderedFaqDraft } from './faq.entity.js';

/**
 * PORT — the `faqs` collection, as this module needs it.
 *
 * ONE WRITE METHOD, AND IT REPLACES THE WHOLE LIST. There is deliberately no `create`, `update`
 * or `delete`: reordering is the ordinary edit here and it moves every row at once, so a per-row
 * surface turns one drag into N calls that can half-fail and leave the list in an order nobody
 * chose. `replaceAll` is also the only shape in which "this id is gone, delete it" can be stated
 * without a separate destructive route.
 *
 * There is no `findOne` either. Every read wants the list — it is a handful of small documents,
 * read far more often than written, and a per-id read has no caller.
 */
export interface FaqRepositoryPort {
  /** Every entry, drafts included, in `sortOrder`. The admin view. */
  findAll(): Promise<FaqItem[]>;

  /**
   * Replaces the list with exactly these entries and returns it as it now stands.
   *
   * A draft carrying an `id` updates that row and keeps its history; one without gets a new id.
   * Any stored row whose id is absent from `drafts` is DELETED — the caller has already decided
   * that, so the confirmation belongs in the UI, not here.
   */
  replaceAll(drafts: readonly OrderedFaqDraft[], updatedBy: string): Promise<FaqItem[]>;
}
