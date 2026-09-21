import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../shared/logging/logger.js';
import { DispatchOfferModel } from '../modules/dispatch/infrastructure/dispatchOffer.model.js';

/**
 * ONE-SHOT MIGRATION — dispatch offers gain an `attempt`, and the unique index gains a column.
 *
 * WHY IT IS NOT OPTIONAL. A scheduled booking is now searched for twice: once when it is made,
 * and again ninety minutes before pickup (docs/LLD/dispatch-and-assignment.md §Ring early, park,
 * ring again). The final ring must be able to offer the trip to a driver the early ring already
 * asked — that driver now knows their morning, which is the entire point of asking again.
 *
 * The old unique index `(bookingId, driverId)` forbids exactly that. Left in place, the final
 * ring fails with a duplicate key on every driver the early ring reached, and a booking that
 * should have been rung twice is rung once. Mongoose will NOT replace an index whose shape
 * changed — it creates the new one beside the old — so the old one has to be dropped by hand.
 *
 * TWO STEPS, IN THIS ORDER, and the order matters:
 *
 *   1. Backfill `attempt: 'FINAL'` onto every existing row. Not a guess: before this feature
 *      every offer belonged to the only search its booking ever got. It also has to happen FIRST,
 *      because `driverIdsOffered(bookingId, 'FINAL')` filters on the field — rows still missing it
 *      would not match, and a ring would offer the same trip to a driver who already had it.
 *   2. Drop `bookingId_1_driverId_1`.
 *
 * IDEMPOTENT. The backfill matches only rows missing the field, and a second run finds none. The
 * drop tolerates the index already being gone, which is the normal state on a fresh database
 * where Mongoose only ever created the new one.
 *
 *     pnpm --filter @driverzone/api exec tsx src/scripts/migrateOfferAttemptIndex.ts
 */
const OLD_UNIQUE_INDEX = 'bookingId_1_driverId_1';

async function main(): Promise<void> {
  await mongoose.connect(env.MONGO_URI);
  logger.info('connected — migrating dispatch offers to the per-attempt unique index');

  const collection = DispatchOfferModel.collection;

  const backfilled = await collection.updateMany(
    { attempt: { $exists: false } },
    { $set: { attempt: 'FINAL' } },
  );
  logger.info({ backfilled: backfilled.modifiedCount }, 'offers stamped as FINAL');

  const before = await collection.indexes();
  if (before.some((index) => index.name === OLD_UNIQUE_INDEX)) {
    await collection.dropIndex(OLD_UNIQUE_INDEX);
    logger.info({ index: OLD_UNIQUE_INDEX }, 'dropped the old two-column unique index');
  } else {
    logger.info({ index: OLD_UNIQUE_INDEX }, 'old index already absent — nothing to drop');
  }

  /*
   * Asserted rather than assumed. If the new index is missing the application is running without
   * the guard that stops one driver being rung twice inside a single search, and that is worth
   * failing loudly over rather than discovering through duplicate offers.
   */
  const after = await collection.indexes();
  const replacement = after.find((index) => index.name === 'bookingId_1_driverId_1_attempt_1');

  if (replacement === undefined) {
    throw new Error(
      'the per-attempt unique index is missing — start the API once to let Mongoose build it, then re-run',
    );
  }

  logger.info({ indexes: after.map((index) => index.name) }, 'migration complete');
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'offer attempt migration failed');
  process.exitCode = 1;
});
