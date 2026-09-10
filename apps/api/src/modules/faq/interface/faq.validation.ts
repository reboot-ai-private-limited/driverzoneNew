import { z } from 'zod';

/**
 * INTERFACE — Zod at the boundary, per docs/engineering/coding-standards.md.
 *
 * Unlike settings, the real validation IS here: an FAQ has no per-key registry behind it, just
 * prose with a length. So this file is the whole rule.
 *
 * THE LIMITS ARE ABOUT THE APPS, not the database. A question has to fit an accordion row on a
 * phone without becoming a paragraph, and an answer long enough to scroll past is one nobody
 * reads to the end of — which for the charge FAQs is the sentence with the number in it. They are
 * generous enough not to be hit in normal writing and tight enough to catch a paste of the wrong
 * thing entirely.
 */

/** Objects, not free strings — a Mongo id shape, so a typo fails here rather than in the driver. */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Expected an id');

const faqItem = z.object({
  /** Absent for a new entry. See `ReplaceFaqsRequest` — this is what distinguishes new from edited. */
  id: objectId.optional(),
  question: z.string().trim().min(1, 'A question is required').max(200),
  answer: z.string().trim().min(1, 'An answer is required').max(4000),
  is_published: z.boolean(),
});

/**
 * AN EMPTY ARRAY IS LEGAL, and that is deliberate: clearing the list is a thing an admin may
 * legitimately want, and refusing it would leave no way to do it but deleting rows one at a
 * time in a shell. The confirmation belongs in the panel, which knows how many rows are about
 * to go.
 *
 * The ceiling is a guard against a runaway client, not an editorial limit — a list this long is
 * already unusable on a phone.
 */
export const replaceFaqsSchema = z.object({
  faqs: z.array(faqItem).max(200),
});

export type ReplaceFaqsInput = z.infer<typeof replaceFaqsSchema>;
