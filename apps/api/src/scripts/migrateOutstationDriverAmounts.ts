import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../shared/logging/logger.js';
import { OutstationPackageModel } from '../modules/packages/infrastructure/outstationPackage.model.js';

/**
 * ONE-SHOT MIGRATION — Separate One-Way / Round-Trip Driver Share and Hourly Variants for Outstation.
 *
 * Replaces root `driverAmountPaise` with:
 * - `oneWayDriverAmountPaise`
 * - `roundTripDriverAmountPaise` (null if roundTripFarePaise is null)
 * - `variants` ([] if absent)
 *
 * IDEMPOTENT: skips documents that already have `oneWayDriverAmountPaise`.
 *
 * Run via:
 *   pnpm --filter @driverzone/api exec tsx src/scripts/migrateOutstationDriverAmounts.ts
 */

async function main(): Promise<void> {
  await mongoose.connect(env.MONGO_URI);
  logger.info('connected — migrating outstation driver amounts to one-way / round-trip split');

  const outstation = await OutstationPackageModel.collection
    .find<{
      _id: mongoose.Types.ObjectId;
      oneWayFarePaise?: number;
      roundTripFarePaise?: number | null;
      driverAmountPaise?: number;
      oneWayDriverAmountPaise?: number;
      roundTripDriverAmountPaise?: number | null;
      variants?: unknown[];
    }>({})
    .toArray();

  let updated = 0;
  let skipped = 0;

  for (const band of outstation) {
    if (typeof band.oneWayDriverAmountPaise === 'number' && Array.isArray(band.variants)) {
      skipped += 1;
      continue;
    }

    const legacyDriverAmount = band.driverAmountPaise ?? 0;
    const oneWayDriverAmount = band.oneWayDriverAmountPaise ?? legacyDriverAmount;
    const roundTripDriverAmount =
      band.roundTripDriverAmountPaise ??
      (band.roundTripFarePaise !== null && band.roundTripFarePaise !== undefined
        ? legacyDriverAmount
        : null);

    await OutstationPackageModel.collection.updateOne(
      { _id: band._id },
      {
        $set: {
          oneWayDriverAmountPaise: oneWayDriverAmount,
          roundTripDriverAmountPaise: roundTripDriverAmount,
          variants: band.variants ?? [],
        },
        $unset: { driverAmountPaise: '' },
      },
    );
    updated += 1;
  }

  logger.info({ updated, skipped }, 'outstation driver amounts migration complete');
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'migration failed');
  process.exit(1);
});
