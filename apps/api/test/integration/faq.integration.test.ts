import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../../src/shared/db/mongo.js';
import { loadEnv } from '../../src/config/env.js';
import { MongoFaqRepository } from '../../src/modules/faq/infrastructure/faq.repository.impl.js';
import { FaqModel } from '../../src/modules/faq/infrastructure/faq.model.js';
import { orderedForWrite } from '../../src/modules/faq/domain/faq.entity.js';

/**
 * The FAQ list write, against a real Mongo.
 *
 * IT EXISTS BECAUSE THE UNIT TESTS COULD NOT SEE THE BUG THAT SHIPPED. `replaceAll` sends one
 * `bulkWrite`, and the first version ordered its operations so that the prune of dropped rows ran
 * AFTER the inserts — deleting every newly added FAQ inside the same batch. The in-memory fake in
 * `faq.test.ts` pruned before writing, so it was perfectly happy, and the admin panel reported
 * "0 FAQs saved" over an empty list.
 *
 * `faq.test.ts` now pins the operation order directly, which catches that specific mistake
 * without a database. This suite is the backstop for the class of mistake: it runs the real
 * driver against the real collection, where the semantics of `$nin` and of an ordered batch are
 * Mongo's to define rather than ours to imagine.
 */
describe('FAQ Repository Integration', () => {
  let repo: MongoFaqRepository;

  const draft = (over: Partial<{ id: string; question: string; answer: string; isPublished: boolean }> = {}) => ({
    question: over.question ?? 'Who pays for the driver’s meals?',
    answer: over.answer ?? 'You do, directly to the driver.',
    isPublished: over.isPublished ?? true,
    ...(over.id === undefined ? {} : { id: over.id }),
  });

  beforeAll(async () => {
    // Fails the suite immediately if MONGO_URI is missing.
    loadEnv();
    await connectMongo();
    repo = new MongoFaqRepository();
  });

  afterAll(async () => {
    await disconnectMongo();
  });

  beforeEach(async () => {
    await FaqModel.deleteMany({});
  });

  /** THE REGRESSION. Adding an FAQ to an empty list saved nothing at all. */
  it('persists a brand-new FAQ', async () => {
    const saved = await repo.replaceAll(orderedForWrite([draft()]), new mongoose.Types.ObjectId().toHexString());

    expect(saved).toHaveLength(1);
    expect(saved[0]?.question).toBe('Who pays for the driver’s meals?');
    // Read back independently: `replaceAll` returns its own `findAll`, and the point of this test
    // is that the row is in the collection, not that one method agrees with itself.
    expect(await FaqModel.countDocuments()).toBe(1);
  });

  /** The mixed case, which is what the panel sends on every save after the first. */
  it('adds a new FAQ alongside an existing one without deleting either', async () => {
    const admin = new mongoose.Types.ObjectId().toHexString();
    const [first] = await repo.replaceAll(orderedForWrite([draft({ question: 'first' })]), admin);

    const saved = await repo.replaceAll(
      orderedForWrite([draft({ id: first?.id, question: 'first' }), draft({ question: 'second' })]),
      admin,
    );

    expect(saved.map((f) => f.question)).toEqual(['first', 'second']);
    // The kept row is the SAME row — an edit must not orphan an entry's history.
    expect(saved[0]?.id).toBe(first?.id);
  });

  it('deletes only the entries dropped from the list', async () => {
    const admin = new mongoose.Types.ObjectId().toHexString();
    const stored = await repo.replaceAll(
      orderedForWrite([draft({ question: 'keep' }), draft({ question: 'drop' })]),
      admin,
    );

    const saved = await repo.replaceAll(
      orderedForWrite([draft({ id: stored[0]?.id, question: 'keep' })]),
      admin,
    );

    expect(saved.map((f) => f.question)).toEqual(['keep']);
    expect(await FaqModel.countDocuments()).toBe(1);
  });

  it('renumbers sortOrder from array position on a reorder, and keeps both rows', async () => {
    const admin = new mongoose.Types.ObjectId().toHexString();
    const stored = await repo.replaceAll(
      orderedForWrite([draft({ question: 'a' }), draft({ question: 'b' })]),
      admin,
    );

    const saved = await repo.replaceAll(
      orderedForWrite([
        draft({ id: stored[1]?.id, question: 'b' }),
        draft({ id: stored[0]?.id, question: 'a' }),
      ]),
      admin,
    );

    expect(saved.map((f) => f.question)).toEqual(['b', 'a']);
    expect(saved.map((f) => f.sortOrder)).toEqual([0, 1]);
  });

  it('clears the collection on an empty list', async () => {
    const admin = new mongoose.Types.ObjectId().toHexString();
    await repo.replaceAll(orderedForWrite([draft()]), admin);

    expect(await repo.replaceAll([], admin)).toEqual([]);
    expect(await FaqModel.countDocuments()).toBe(0);
  });

  it('stores an unpublished draft, so it survives to be published later', async () => {
    const admin = new mongoose.Types.ObjectId().toHexString();
    const saved = await repo.replaceAll(orderedForWrite([draft({ isPublished: false })]), admin);

    expect(saved[0]?.isPublished).toBe(false);
    expect(await FaqModel.countDocuments()).toBe(1);
  });
});
