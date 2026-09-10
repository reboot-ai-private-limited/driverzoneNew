import { describe, expect, it } from 'vitest';
import {
  orderedForWrite,
  publishedOnly,
  type FaqItem,
  type OrderedFaqDraft,
} from '../src/modules/faq/domain/faq.entity.js';
import type { FaqRepositoryPort } from '../src/modules/faq/domain/faq.repository.port.js';
import type { AuditEntry, AuditPort } from '../src/modules/faq/domain/audit.port.js';
import { ListFaqsUseCase } from '../src/modules/faq/application/useCases/listFaqs.usecase.js';
import { ListPublishedFaqsUseCase } from '../src/modules/faq/application/useCases/listPublishedFaqs.usecase.js';
import { ReplaceFaqsUseCase } from '../src/modules/faq/application/useCases/replaceFaqs.usecase.js';
import { replaceFaqsSchema } from '../src/modules/faq/interface/faq.validation.js';
import { buildReplaceOperations } from '../src/modules/faq/infrastructure/faq.repository.impl.js';

/**
 * An in-memory stand-in for the `faqs` collection, reproducing the two behaviours the use case
 * actually depends on: ids survive an edit, and an id absent from the write disappears.
 *
 * IT CANNOT CATCH A BUG IN THE REAL WRITE, and one got through exactly here — the Mongo
 * implementation ordered its bulk operations so that a freshly inserted row was deleted again by
 * the same batch, while this fake pruned before writing and was perfectly happy. That is the gap
 * every fake leaves. The ordering it could not see is now pinned directly, over
 * `buildReplaceOperations`, at the bottom of this file.
 */
function fakeRepo(seed: Array<Partial<FaqItem> & { id: string }> = []) {
  const rows = new Map<string, FaqItem>(
    seed.map((row) => [
      row.id,
      {
        id: row.id,
        question: row.question ?? `Q${row.id}`,
        answer: row.answer ?? `A${row.id}`,
        sortOrder: row.sortOrder ?? 0,
        isPublished: row.isPublished ?? true,
        updatedAt: row.updatedAt ?? new Date('2026-09-01'),
      },
    ]),
  );

  let minted = 0;

  const repo: FaqRepositoryPort & { rows: Map<string, FaqItem> } = {
    rows,
    findAll: async () => [...rows.values()].sort((a, b) => a.sortOrder - b.sortOrder),
    replaceAll: async (drafts: readonly OrderedFaqDraft[]) => {
      const keep = new Set(drafts.map((d) => d.id).filter((id): id is string => id !== undefined));
      for (const id of [...rows.keys()]) if (!keep.has(id)) rows.delete(id);

      for (const draft of drafts) {
        const id = draft.id ?? `new${String(++minted)}`;
        rows.set(id, {
          id,
          question: draft.question,
          answer: draft.answer,
          sortOrder: draft.sortOrder,
          isPublished: draft.isPublished,
          updatedAt: new Date('2026-09-10'),
        });
      }

      return [...rows.values()].sort((a, b) => a.sortOrder - b.sortOrder);
    },
  };
  return repo;
}

function fakeAudit(): AuditPort & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return { entries, record: async (entry) => void entries.push(entry) };
}

const actor = { adminId: '507f1f77bcf86cd799439011', ip: '10.0.0.1' };

describe('faq ordering', () => {
  it('numbers the list from its array position, ignoring anything the client sent', () => {
    const ordered = orderedForWrite([
      { question: 'b', answer: 'B', isPublished: true },
      { question: 'a', answer: 'A', isPublished: true },
      { question: 'c', answer: 'C', isPublished: false },
    ]);

    expect(ordered.map((f) => f.sortOrder)).toEqual([0, 1, 2]);
    expect(ordered.map((f) => f.question)).toEqual(['b', 'a', 'c']);
  });

  it('is dense from zero, so a reordered list never leaves gaps', () => {
    expect(orderedForWrite([]).map((f) => f.sortOrder)).toEqual([]);
    expect(orderedForWrite(Array.from({ length: 4 }, () => ({ question: 'q', answer: 'a', isPublished: true })))
      .map((f) => f.sortOrder)).toEqual([0, 1, 2, 3]);
  });
});

describe('publishedOnly', () => {
  const rows: FaqItem[] = [
    { id: '3', question: 'third', answer: 'c', sortOrder: 2, isPublished: true, updatedAt: new Date() },
    { id: '2', question: 'draft', answer: 'b', sortOrder: 1, isPublished: false, updatedAt: new Date() },
    { id: '1', question: 'first', answer: 'a', sortOrder: 0, isPublished: true, updatedAt: new Date() },
  ];

  it('drops drafts and returns the rest in display order', () => {
    expect(publishedOnly(rows).map((f) => f.question)).toEqual(['first', 'third']);
  });

  it('closes the gap a draft leaves rather than reporting its position', () => {
    // The apps render the array as given; what matters is that removing the middle entry does not
    // leave a hole in the list they draw, not that sortOrder is renumbered.
    expect(publishedOnly(rows).map((f) => f.sortOrder)).toEqual([0, 2]);
  });
});

describe('ListPublishedFaqsUseCase', () => {
  it('is the read the apps get, and it never returns a draft', async () => {
    const repo = fakeRepo([
      { id: 'a', question: 'live', sortOrder: 0, isPublished: true },
      { id: 'b', question: 'draft', sortOrder: 1, isPublished: false },
    ]);

    const published = await new ListPublishedFaqsUseCase(repo).execute();
    const admin = await new ListFaqsUseCase(repo).execute();

    expect(published.map((f) => f.question)).toEqual(['live']);
    // The same repository, unfiltered, for the admin — the filter is the use case, not the data.
    expect(admin.map((f) => f.question)).toEqual(['live', 'draft']);
  });
});

describe('ReplaceFaqsUseCase', () => {
  it('keeps the ids of entries that survive, so an edit does not orphan their history', async () => {
    const repo = fakeRepo([{ id: 'keep', question: 'old', sortOrder: 0 }]);

    const saved = await new ReplaceFaqsUseCase(repo, fakeAudit()).execute(
      [{ id: 'keep', question: 'new wording', answer: 'A', isPublished: true }],
      actor,
    );

    expect(saved).toHaveLength(1);
    expect(saved[0]?.id).toBe('keep');
    expect(saved[0]?.question).toBe('new wording');
  });

  it('mints ids for entries that arrive without one', async () => {
    const repo = fakeRepo();

    const saved = await new ReplaceFaqsUseCase(repo, fakeAudit()).execute(
      [{ question: 'brand new', answer: 'A', isPublished: false }],
      actor,
    );

    expect(saved[0]?.id).toBeTruthy();
    expect(saved[0]?.isPublished).toBe(false);
  });

  it('round-trips a reorder', async () => {
    const repo = fakeRepo([
      { id: 'a', question: 'first', sortOrder: 0 },
      { id: 'b', question: 'second', sortOrder: 1 },
    ]);
    const useCase = new ReplaceFaqsUseCase(repo, fakeAudit());

    const saved = await useCase.execute(
      [
        { id: 'b', question: 'second', answer: 'B', isPublished: true },
        { id: 'a', question: 'first', answer: 'A', isPublished: true },
      ],
      actor,
    );

    expect(saved.map((f) => f.question)).toEqual(['second', 'first']);
    expect(saved.map((f) => f.sortOrder)).toEqual([0, 1]);
  });

  it('deletes the entries the admin dropped from the list', async () => {
    const repo = fakeRepo([
      { id: 'a', question: 'kept' },
      { id: 'b', question: 'dropped' },
    ]);

    const saved = await new ReplaceFaqsUseCase(repo, fakeAudit()).execute(
      [{ id: 'a', question: 'kept', answer: 'A', isPublished: true }],
      actor,
    );

    expect(saved.map((f) => f.question)).toEqual(['kept']);
  });

  it('clears the list when the array is empty, rather than treating it as a no-op', async () => {
    const repo = fakeRepo([{ id: 'a' }, { id: 'b' }]);

    expect(await new ReplaceFaqsUseCase(repo, fakeAudit()).execute([], actor)).toEqual([]);
  });

  /**
   * The stale-page case: a colleague deleted the row this admin is still editing. Resurrecting it
   * under a new id would be the wrong answer to a question the admin did not ask.
   */
  it('refuses a list naming an id that no longer exists, and writes nothing', async () => {
    const repo = fakeRepo([{ id: 'a', question: 'untouched' }]);
    const audit = fakeAudit();

    await expect(
      new ReplaceFaqsUseCase(repo, audit).execute(
        [
          { id: 'a', question: 'edited', answer: 'A', isPublished: true },
          { id: 'gone', question: 'deleted by someone else', answer: 'B', isPublished: true },
        ],
        actor,
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: 'FAQ_NOT_FOUND' });

    expect(repo.rows.get('a')?.question).toBe('untouched');
    expect(audit.entries).toHaveLength(0);
  });

  it('audits the whole list either side of the save — the only record of deleted text', async () => {
    const repo = fakeRepo([{ id: 'a', question: 'about to be deleted' }]);
    const audit = fakeAudit();

    await new ReplaceFaqsUseCase(repo, audit).execute(
      [{ question: 'its replacement', answer: 'A', isPublished: true }],
      actor,
    );

    expect(audit.entries).toHaveLength(1);
    const [entry] = audit.entries;
    expect(entry?.action).toBe('UPDATE');
    expect(entry?.entityType).toBe('Faq');
    expect((entry?.before as FaqItem[])[0]?.question).toBe('about to be deleted');
    expect((entry?.after as FaqItem[])[0]?.question).toBe('its replacement');
  });
});

describe('replaceFaqsSchema', () => {
  const valid = { question: 'Who pays for meals?', answer: 'You do, directly.', is_published: true };

  it('accepts an entry with no id as a new one', () => {
    expect(replaceFaqsSchema.parse({ faqs: [valid] }).faqs[0]?.id).toBeUndefined();
  });

  it('accepts an empty list — clearing the FAQs is a thing an admin may do', () => {
    expect(replaceFaqsSchema.parse({ faqs: [] }).faqs).toEqual([]);
  });

  it('rejects a blank question or answer, including one that is only whitespace', () => {
    expect(replaceFaqsSchema.safeParse({ faqs: [{ ...valid, question: '   ' }] }).success).toBe(false);
    expect(replaceFaqsSchema.safeParse({ faqs: [{ ...valid, answer: '' }] }).success).toBe(false);
  });

  it('rejects an answer long enough that nobody reaches the number in it', () => {
    expect(replaceFaqsSchema.safeParse({ faqs: [{ ...valid, answer: 'x'.repeat(4001) }] }).success).toBe(false);
  });

  it('rejects an id that is not an object id, before it reaches the driver', () => {
    expect(replaceFaqsSchema.safeParse({ faqs: [{ ...valid, id: 'not-an-id' }] }).success).toBe(false);
  });

  it('trims, so a pasted answer with trailing whitespace stores clean', () => {
    const parsed = replaceFaqsSchema.parse({ faqs: [{ ...valid, question: '  Who pays?  ' }] });
    expect(parsed.faqs[0]?.question).toBe('Who pays?');
  });
});

/**
 * THE REGRESSION THAT SHIPPED. Adding an FAQ saved nothing: the admin pressed Save, was told
 * "0 FAQs saved", and the list came back empty.
 *
 * The cause was operation ORDER inside one `bulkWrite`. The prune of dropped rows —
 * `deleteMany({_id: {$nin: keptIds}})` — was appended last, and a brand-new FAQ has no id, so it
 * is not in `keptIds`, so the filter matched the very document inserted a few operations earlier
 * and removed it again. Nothing about the use case, the validation or the fake repository was
 * wrong, which is why every test above passed.
 *
 * These assert the one property that makes the write correct: the delete sees only what was
 * already stored, because it happens before anything is written.
 */
describe('buildReplaceOperations', () => {
  const admin = '507f1f77bcf86cd799439011';
  const existing = '507f1f77bcf86cd799439022';

  const newDraft = { question: 'q', answer: 'a', isPublished: true, sortOrder: 0 };

  it('puts the delete FIRST, so it cannot reach a row this batch is about to insert', () => {
    const operations = buildReplaceOperations([newDraft], admin);

    expect(operations[0]).toHaveProperty('deleteMany');
    expect(operations.slice(1).every((op) => !('deleteMany' in op))).toBe(true);
  });

  it('inserts a draft with no id, rather than updating nothing', () => {
    const operations = buildReplaceOperations([newDraft], admin);

    expect(operations).toHaveLength(2);
    expect(operations[1]).toHaveProperty('insertOne');
  });

  it('updates a draft that carries an id, so the row keeps its identity', () => {
    const operations = buildReplaceOperations([{ ...newDraft, id: existing }], admin);

    expect(operations[1]).toHaveProperty('updateOne');
  });

  /** The case that broke: one row kept, one added. The new one must survive the prune. */
  it('spares the kept row and does not delete the new one', () => {
    const operations = buildReplaceOperations(
      [{ ...newDraft, id: existing }, { ...newDraft, sortOrder: 1 }],
      admin,
    );

    const [prune] = operations;
    const kept = prune !== undefined && 'deleteMany' in prune ? prune.deleteMany.filter : undefined;

    // The prune names the row being kept, and the new row is not yet in the collection for it
    // to match — which is only true because this operation runs first.
    expect(JSON.stringify(kept)).toContain(existing);
    expect(operations).toHaveLength(3);
  });

  it('clears the collection when every draft is new — nothing stored is worth keeping', () => {
    const [prune] = buildReplaceOperations([newDraft], admin);
    const filter = prune !== undefined && 'deleteMany' in prune ? prune.deleteMany.filter : undefined;

    expect(filter).toEqual({ _id: { $nin: [] } });
  });

  it('clears the collection on an empty list, and writes nothing else', () => {
    const operations = buildReplaceOperations([], admin);

    expect(operations).toHaveLength(1);
    expect(operations[0]).toHaveProperty('deleteMany');
  });
});
