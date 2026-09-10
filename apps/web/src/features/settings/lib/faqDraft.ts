import type { FaqDto, ReplaceFaqItem } from '@driverzone/contracts';

/**
 * The FAQ panel's client-side state, kept out of the component so it can be tested without one —
 * same split as `lib/draft.ts` does for the settings form.
 *
 * A DRAFT CARRIES A LOCAL `key`, and that is the load-bearing detail. A new row has no server id
 * until it is saved, so array index is the only other candidate for React's key — and index is
 * exactly wrong for a list whose whole point is reordering: move a row and every index below it
 * shifts, so React reuses the wrong DOM node and the text the admin is typing jumps into a
 * different row. `key` is minted once, locally, and never changes.
 */
export interface FaqDraft {
  /** Client-side identity. Not sent, not stored, stable for the lifetime of the row on screen. */
  key: string;
  /** The server's id. Absent until this row has been saved once. */
  id?: string | undefined;
  question: string;
  answer: string;
  isPublished: boolean;
}

let minted = 0;

/** Unique within one mount, which is all `key` has to be. */
function nextKey(): string {
  minted += 1;
  return `faq-${String(minted)}`;
}

export function toDrafts(faqs: readonly FaqDto[]): FaqDraft[] {
  return faqs.map((faq) => ({
    key: nextKey(),
    id: faq.id,
    question: faq.question,
    answer: faq.answer,
    isPublished: faq.is_published,
  }));
}

/**
 * A new row starts UNPUBLISHED. Ops is about to type into an empty box, and the half-written
 * sentence they get up and walk away from should not be the sentence a customer reads. Publishing
 * is then one deliberate tick.
 */
export function emptyDraft(): FaqDraft {
  return { key: nextKey(), question: '', answer: '', isPublished: false };
}

/** Moves one row, clamped. Returns the same array reference when the move is a no-op. */
export function moveDraft(drafts: readonly FaqDraft[], from: number, to: number): FaqDraft[] {
  if (to < 0 || to >= drafts.length || from === to) return [...drafts];
  const next = [...drafts];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

/**
 * The request body. `sort_order` is not sent — the server assigns it from array position, which
 * is why this is a straight map with no index arithmetic anywhere in it.
 */
export function buildBody(drafts: readonly FaqDraft[]): ReplaceFaqItem[] {
  return drafts.map((draft) => ({
    ...(draft.id === undefined ? {} : { id: draft.id }),
    question: draft.question.trim(),
    answer: draft.answer.trim(),
    is_published: draft.isPublished,
  }));
}

/**
 * Client-side problems, keyed by the row's local `key`.
 *
 * The API validates all of this too and is the authority. This exists so the admin is told before
 * a round trip, and — more to the point — so Save can be disabled rather than firing a request
 * that will delete nothing and change nothing but still returns a red toast.
 */
export function validate(drafts: readonly FaqDraft[]): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const draft of drafts) {
    if (draft.question.trim().length === 0) {
      errors[draft.key] = 'A question is required.';
    } else if (draft.answer.trim().length === 0) {
      errors[draft.key] = 'An answer is required.';
    } else if (draft.question.trim().length > 200) {
      errors[draft.key] = 'Questions are limited to 200 characters.';
    } else if (draft.answer.trim().length > 4000) {
      errors[draft.key] = 'Answers are limited to 4000 characters.';
    }
  }

  return errors;
}

/**
 * Whether anything would actually change — content, publication, or ORDER.
 *
 * Order is why this compares positionally rather than as a set. Reordering the list changes
 * nothing about any individual entry, and a dirty check that missed it would leave Save disabled
 * on the one edit the admin most expects to be able to make.
 */
export function isDirty(drafts: readonly FaqDraft[], saved: readonly FaqDto[]): boolean {
  if (drafts.length !== saved.length) return true;

  return drafts.some((draft, index) => {
    const original = saved[index];
    if (original === undefined) return true;
    return (
      draft.id !== original.id ||
      draft.question.trim() !== original.question ||
      draft.answer.trim() !== original.answer ||
      draft.isPublished !== original.is_published
    );
  });
}

/** How many stored entries the save would delete. The panel confirms before sending a list this shortens. */
export function deletedCount(drafts: readonly FaqDraft[], saved: readonly FaqDto[]): number {
  const keptIds = new Set(drafts.map((draft) => draft.id).filter((id) => id !== undefined));
  return saved.filter((faq) => !keptIds.has(faq.id)).length;
}
