import mongoose from 'mongoose';
import type { FaqItem, OrderedFaqDraft } from '../domain/faq.entity.js';
import type { FaqRepositoryPort } from '../domain/faq.repository.port.js';
import { FaqModel, type FaqDoc } from './faq.model.js';

/** INFRASTRUCTURE — the `faqs` collection. */

function toItem(doc: FaqDoc): FaqItem {
  return {
    id: String(doc._id),
    question: doc.question,
    answer: doc.answer,
    sortOrder: doc.sortOrder,
    isPublished: doc.isPublished,
    updatedAt: doc.updatedAt,
  };
}

export type FaqBulkOperation = Parameters<typeof FaqModel.bulkWrite>[0][number];

/**
 * The bulk operations a `replaceAll` runs, built separately from running them so the ORDER can be
 * tested without a database. It is exported for that reason alone — nothing outside this file and
 * its test should call it.
 *
 * THE DELETE IS FIRST, AND THAT IS THE WHOLE CORRECTNESS OF THIS FUNCTION.
 *
 * It came last once, and every newly added FAQ was inserted and then deleted again inside the
 * same batch: a new row has no id, so it is not in `keptIds`, so `$nin: keptIds` matched the
 * document that had just been inserted a few operations earlier. The admin saw "0 FAQs saved" and
 * an empty list, and no unit test caught it because the in-memory fake in `faq.test.ts` pruned
 * before it wrote — the fake was correct and the real thing was not, which is exactly the gap a
 * fake leaves. Hence this function, and the ordering test over it.
 *
 * Deleting first is safe precisely because the new rows do not exist yet: the filter can only see
 * what was already stored, which is the set it is meant to prune. An empty `keptIds` therefore
 * clears the collection, which is right — every draft is new, so nothing stored survives.
 */
export function buildReplaceOperations(
  drafts: readonly OrderedFaqDraft[],
  updatedBy: string,
): FaqBulkOperation[] {
  const adminId = new mongoose.Types.ObjectId(updatedBy);
  const keptIds = drafts
    .map((draft) => draft.id)
    .filter((id): id is string => id !== undefined)
    .map((id) => new mongoose.Types.ObjectId(id));

  const operations: FaqBulkOperation[] = [
    { deleteMany: { filter: { _id: { $nin: keptIds } } } },
  ];

  for (const draft of drafts) {
    const fields = {
      question: draft.question,
      answer: draft.answer,
      sortOrder: draft.sortOrder,
      isPublished: draft.isPublished,
      updatedBy: adminId,
    };

    operations.push(
      draft.id === undefined
        ? { insertOne: { document: fields } }
        : {
            updateOne: {
              filter: { _id: new mongoose.Types.ObjectId(draft.id) },
              update: { $set: fields },
            },
          },
    );
  }

  return operations;
}

export class MongoFaqRepository implements FaqRepositoryPort {
  async findAll(): Promise<FaqItem[]> {
    const docs = await FaqModel.find().sort({ sortOrder: 1 }).lean<FaqDoc[]>();
    return docs.map(toItem);
  }

  /**
   * The list, replaced.
   *
   * NOT delete-everything-then-insert, which is the obvious implementation and the wrong one: it
   * changes every id on every save, so an entry's audit history and its `createdAt` are lost the
   * first time somebody fixes a typo. Instead each surviving draft updates its own row in place,
   * new drafts are inserted, and only the rows the admin actually dropped are deleted.
   *
   * `bulkWrite` rather than a loop of `findOneAndUpdate`: unlike settings, the caller audits the
   * list as a whole and does not need each document handed back, so there is nothing to be gained
   * by paying a round trip per row. The list is re-read afterwards, which is also what guarantees
   * the returned order is the stored one rather than the one we hoped we wrote.
   *
   * Not in a transaction, same reasoning as `MongoSettingRepository.putMany`: the use case has
   * already validated everything, so the only remaining failure is an unreachable database.
   */
  async replaceAll(drafts: readonly OrderedFaqDraft[], updatedBy: string): Promise<FaqItem[]> {
    // `ordered` is not a detail: it is what guarantees the delete that `buildReplaceOperations`
    // puts first actually runs before the inserts, rather than alongside them.
    await FaqModel.bulkWrite(buildReplaceOperations(drafts, updatedBy), { ordered: true });

    return this.findAll();
  }
}
