/**
 * DOMAIN — one FAQ, and the rules about a list of them.
 *
 * The whole module exists because ops needs to publish prose without a deploy — most urgently the
 * cash amounts a customer settles with the driver directly (food, a place to stay on a long
 * trip), which are not fare lines, never appear in a quote, and had no stated figure anywhere in
 * the product before this. `packages/contracts/src/faq.ts` carries that reasoning in full.
 *
 * NOTHING HERE COMPUTES WITH THE CONTENT. An answer is text an admin wrote; this module stores it,
 * orders it, and decides who may read it. The moment something starts parsing a price out of an
 * answer, that price belongs in the settings registry instead.
 */

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  /** Ascending, dense from 0, assigned by `orderedForWrite` — never by a client. */
  sortOrder: number;
  isPublished: boolean;
  updatedAt: Date;
}

/** One entry as it arrives on a write. No `id` means "new"; the repository mints one. */
export interface FaqDraft {
  id?: string | undefined;
  question: string;
  answer: string;
  isPublished: boolean;
}

/** A draft with its position resolved. What the repository is actually handed. */
export interface OrderedFaqDraft extends FaqDraft {
  sortOrder: number;
}

/**
 * THE ORDER COMES FROM THE ARRAY, and this is the only place that decision is made.
 *
 * A client sends the list in the order it should read and nothing else. It does not send indices:
 * two admins reordering the same list at once would each compute positions against a list the
 * other had already changed, and the merge of two such sets is a scrambled list rather than
 * either admin's intent. Deriving position here means the last write wins WHOLE, which is at
 * least an order somebody chose.
 *
 * Dense from 0 rather than sparse (10, 20, 30...) because the list is replaced entire on every
 * write — there is no insert-between operation for gaps to leave room for.
 */
export function orderedForWrite(drafts: readonly FaqDraft[]): OrderedFaqDraft[] {
  return drafts.map((draft, index) => ({ ...draft, sortOrder: index }));
}

/**
 * What the apps are allowed to see, in the order they should see it.
 *
 * THE ONLY FILTER, applied in one place, so no future read path can forget it. An unpublished
 * entry is a draft ops is still writing or one they pulled down in a hurry; either way it is not
 * something a customer should find in the app.
 */
export function publishedOnly(faqs: readonly FaqItem[]): FaqItem[] {
  return faqs.filter((faq) => faq.isPublished).sort((a, b) => a.sortOrder - b.sortOrder);
}
