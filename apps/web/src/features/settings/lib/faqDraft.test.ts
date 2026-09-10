import { describe, expect, it } from 'vitest';
import type { FaqDto } from '@driverzone/contracts';
import { buildBody, deletedCount, emptyDraft, isDirty, moveDraft, toDrafts, validate } from './faqDraft';

/**
 * The panel's logic, tested without a DOM — same posture as `draft.test.ts`. The interesting
 * failures here are ordering and the dirty check, not rendering.
 */

function faq(over: Partial<FaqDto> & Pick<FaqDto, 'id'>): FaqDto {
  return {
    question: `Q${over.id}`,
    answer: `A${over.id}`,
    sort_order: 0,
    is_published: true,
    updated_at: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

describe('toDrafts', () => {
  it('gives every row a local key distinct from its server id', () => {
    const drafts = toDrafts([faq({ id: 'a' }), faq({ id: 'b' })]);

    expect(drafts.map((d) => d.id)).toEqual(['a', 'b']);
    expect(new Set(drafts.map((d) => d.key)).size).toBe(2);
    expect(drafts[0]?.key).not.toBe('a');
  });
});

describe('emptyDraft', () => {
  it('starts unpublished, so a half-written answer is never live', () => {
    expect(emptyDraft().isPublished).toBe(false);
  });

  it('has no id — that is what tells the server it is new', () => {
    expect(emptyDraft().id).toBeUndefined();
  });

  it('mints a fresh key each time, so two new rows are not the same row', () => {
    expect(emptyDraft().key).not.toBe(emptyDraft().key);
  });
});

describe('moveDraft', () => {
  const rows = toDrafts([faq({ id: 'a' }), faq({ id: 'b' }), faq({ id: 'c' })]);

  it('moves a row up', () => {
    expect(moveDraft(rows, 2, 1).map((d) => d.id)).toEqual(['a', 'c', 'b']);
  });

  it('moves a row down', () => {
    expect(moveDraft(rows, 0, 1).map((d) => d.id)).toEqual(['b', 'a', 'c']);
  });

  it('clamps at both ends rather than dropping the row off the list', () => {
    expect(moveDraft(rows, 0, -1).map((d) => d.id)).toEqual(['a', 'b', 'c']);
    expect(moveDraft(rows, 2, 3).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps each row its own key, so React does not reuse the wrong input', () => {
    const moved = moveDraft(rows, 0, 2);
    expect(moved.map((d) => d.key)).toEqual([rows[1]?.key, rows[2]?.key, rows[0]?.key]);
  });
});

describe('buildBody', () => {
  it('omits the id on a new row and keeps it on an existing one', () => {
    const body = buildBody([{ ...emptyDraft(), question: 'q', answer: 'a' }, ...toDrafts([faq({ id: 'x' })])]);

    expect(body[0]).not.toHaveProperty('id');
    expect(body[1]).toMatchObject({ id: 'x' });
  });

  it('sends no sort_order — the server assigns it from array position', () => {
    expect(buildBody(toDrafts([faq({ id: 'a' })]))[0]).not.toHaveProperty('sort_order');
  });

  it('trims, so a pasted answer does not save with trailing whitespace', () => {
    const body = buildBody([{ ...emptyDraft(), question: '  q  ', answer: '  a\n' }]);
    expect(body[0]).toMatchObject({ question: 'q', answer: 'a' });
  });
});

describe('validate', () => {
  it('accepts a complete row', () => {
    expect(validate([{ ...emptyDraft(), question: 'q', answer: 'a' }])).toEqual({});
  });

  it('rejects a blank question, and one that is only whitespace', () => {
    const row = { ...emptyDraft(), question: '   ', answer: 'a' };
    expect(validate([row])[row.key]).toBe('A question is required.');
  });

  it('rejects a blank answer', () => {
    const row = { ...emptyDraft(), question: 'q', answer: '' };
    expect(validate([row])[row.key]).toBe('An answer is required.');
  });

  it('rejects an answer past the length the app can render sensibly', () => {
    const row = { ...emptyDraft(), question: 'q', answer: 'x'.repeat(4001) };
    expect(validate([row])[row.key]).toContain('4000');
  });

  it('keys problems by row, so two bad rows both light up', () => {
    const a = { ...emptyDraft(), question: '', answer: 'a' };
    const b = { ...emptyDraft(), question: 'q', answer: '' };
    expect(Object.keys(validate([a, b]))).toEqual([a.key, b.key]);
  });
});

describe('isDirty', () => {
  const saved = [faq({ id: 'a' }), faq({ id: 'b' })];

  it('is false for an untouched list', () => {
    expect(isDirty(toDrafts(saved), saved)).toBe(false);
  });

  /** The edit this panel exists for. A set comparison would miss it entirely. */
  it('is TRUE for a pure reorder, where no entry itself changed', () => {
    expect(isDirty(moveDraft(toDrafts(saved), 0, 1), saved)).toBe(true);
  });

  it('is true when the text changes', () => {
    const drafts = toDrafts(saved);
    expect(isDirty([{ ...drafts[0]!, question: 'reworded' }, drafts[1]!], saved)).toBe(true);
  });

  it('is true when only the published flag changes', () => {
    const drafts = toDrafts(saved);
    expect(isDirty([{ ...drafts[0]!, isPublished: false }, drafts[1]!], saved)).toBe(true);
  });

  it('is true when a row is added or removed', () => {
    expect(isDirty([...toDrafts(saved), emptyDraft()], saved)).toBe(true);
    expect(isDirty(toDrafts(saved).slice(1), saved)).toBe(true);
  });

  it('ignores whitespace the admin has not really added', () => {
    const drafts = toDrafts(saved);
    expect(isDirty([{ ...drafts[0]!, question: `  ${drafts[0]!.question}  ` }, drafts[1]!], saved)).toBe(
      false,
    );
  });
});

describe('deletedCount', () => {
  const saved = [faq({ id: 'a' }), faq({ id: 'b' }), faq({ id: 'c' })];

  it('counts the stored entries a save would remove', () => {
    expect(deletedCount(toDrafts(saved).slice(0, 1), saved)).toBe(2);
  });

  it('is zero for a reorder — nothing is lost by moving a row', () => {
    expect(deletedCount(moveDraft(toDrafts(saved), 0, 2), saved)).toBe(0);
  });

  it('does not count new rows, which delete nothing', () => {
    expect(deletedCount([...toDrafts(saved), emptyDraft()], saved)).toBe(0);
  });

  it('counts the whole list when it is cleared', () => {
    expect(deletedCount([], saved)).toBe(3);
  });
});
