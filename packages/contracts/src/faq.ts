/**
 * FAQs — the help content an admin writes and both apps render.
 *
 * THE FIRST ADMIN-AUTHORED CONTENT IN THE PRODUCT. Everything else ops controls without a deploy
 * is a number in `settings.ts`; this is prose, it is a variable-length ordered list, and each
 * entry can be withheld from the apps while it is still being written. That combination is why it
 * is a module of its own rather than a settings key — see the note on `SettingValue`.
 *
 * IT IS ALSO WHERE THE CASH CHARGES ARE WRITTEN DOWN. The driver's food and stay on a long trip
 * are settled outside the app, never appear in a quote, and had no stated amount anywhere until
 * this existed. The customer's fare-sheet warning links here for that reason. The amounts live in
 * the answer PROSE an admin types — they are not a priced field and nothing computes with them.
 *
 * `apps/api` compiles with `exactOptionalPropertyTypes`, so REQUEST fields spell out `| undefined`
 * where optional (see `zones.ts`). Response/DTO shapes are hand-built, never Zod-parsed, and do
 * not need it.
 */

/**
 * ONE LIST, ONE ORDER, NO CATEGORIES. The apps render it top to bottom exactly as the admin
 * arranged it, so the order is editorial — the question ops is tired of answering goes first.
 */
export interface FaqDto {
  id: string;
  question: string;
  answer: string;
  /**
   * Position in the list, ascending, assigned by the SERVER from array position on write. A
   * client never computes it: two admins reordering at once would otherwise each send a set of
   * indices computed against a list the other had already changed.
   */
  sort_order: number;
  /**
   * Whether the apps may see it. An unpublished entry is a draft ops is still writing, or one
   * pulled down in a hurry — the text survives either way, which is what makes it different from
   * deleting. The audience endpoints never return these at all.
   */
  is_published: boolean;
  updated_at: string;
}

/** The admin view: every entry, drafts included, in `sort_order`. */
export interface GetFaqsResponse {
  faqs: FaqDto[];
}

/**
 * What a customer or driver app receives — published entries only, already ordered.
 *
 * Separate from `GetFaqsResponse` even though the shape matches today, because the two are not
 * the same promise: this one guarantees every entry is publishable to a customer, and it must
 * stay possible to add an admin-only field above without widening what the apps are handed.
 */
export interface PublishedFaqsResponse {
  faqs: FaqDto[];
}

/**
 * THE WHOLE LIST, EVERY TIME — not a per-row patch.
 *
 * Reordering is the ordinary edit here and it changes every row's `sort_order` at once, so a
 * per-row write path turns one drag into N requests that can half-succeed and leave the list
 * scrambled. Sending the array entire makes the order a property of the request rather than
 * something the client and server have to agree on afterwards.
 *
 * An entry with no `id` is new. An existing `id` that is absent from the array has been deleted —
 * which is the one genuinely destructive thing this request can do, so the admin UI must confirm
 * before sending a shorter list than it received.
 */
export interface ReplaceFaqsRequest {
  faqs: ReplaceFaqItem[];
}

export interface ReplaceFaqItem {
  /** Omitted for a new entry; the server mints the id. */
  id?: string | undefined;
  question: string;
  answer: string;
  is_published: boolean;
}

export interface ReplaceFaqsResponse {
  faqs: FaqDto[];
}
