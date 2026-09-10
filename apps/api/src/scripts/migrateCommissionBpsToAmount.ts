import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../shared/logging/logger.js';
import { IncityPackageModel } from '../modules/packages/infrastructure/incityPackage.model.js';
import { OutstationPackageModel } from '../modules/packages/infrastructure/outstationPackage.model.js';

/**
 * ONE-SHOT MIGRATION — the driver's share stops being a percentage and becomes a flat amount
 * (decision-log.md 2026-09-10).
 *
 * WHY IT IS NOT OPTIONAL. Every stored package carries `driverCommissionBps` (7500 = 75%); the
 * code that reads it now expects `driverAmountPaise`. On any database with packages, skipping
 * this leaves every one of them missing a required field — the mapper throws, and no quote can
 * be produced.
 *
 * THE CONVERSION. `driverAmountPaise = round(fare * bps / 10000)` — what the old percentage
 * would have paid out on that package's own base fare, ignoring the shared lines (pickup,
 * surcharge, insurance) it also used to take a cut of. So a same-day trip pays the driver
 * exactly what it did before; the company keeps slightly more on any trip that carries those
 * extra lines, which is the intended effect of the change. Ops tunes from there.
 *
 *   - INCITY: converted per variant, against `baseFarePaise`.
 *   - OUTSTATION: converted against `oneWayFarePaise` — the per-day rate. `computeOutstationFare`
 *     multiplies it by the trip's days, exactly as it does the band fare.
 *
 * IDEMPOTENT. A document that already has `driverAmountPaise` and no `driverCommissionBps` is
 * skipped. Running it twice writes nothing the second time.
 *
 *     pnpm --filter @driverzone/api exec tsx src/scripts/migrateCommissionBpsToAmount.ts
 */

function amountFrom(farePaise: number, bps: number): number {
  return Math.round((farePaise * bps) / 10000);
}

async function main(): Promise<void> {
  await mongoose.connect(env.MONGO_URI);
  logger.info('connected — converting package driver commission from bps to a flat amount');

  // `.lean()` with a loose type: these documents still have the OLD field, which the current
  // schema no longer declares, so Mongoose would strip it from a hydrated doc.
  const incity = await IncityPackageModel.collection
    .find<{ _id: mongoose.Types.ObjectId; variants: Array<Record<string, unknown>> }>({})
    .toArray();

  let incityUpdated = 0;
  let incitySkipped = 0;

  for (const pkg of incity) {
    const variants = pkg.variants ?? [];
    const needsWork = variants.some((v) => typeof v['driverCommissionBps'] === 'number');
    if (!needsWork) {
      incitySkipped += 1;
      continue;
    }

    const converted = variants.map((v) => {
      if (typeof v['driverCommissionBps'] !== 'number') return v;
      const base = typeof v['baseFarePaise'] === 'number' ? v['baseFarePaise'] : 0;
      const { driverCommissionBps, ...rest } = v;
      return { ...rest, driverAmountPaise: amountFrom(base, driverCommissionBps as number) };
    });

    await IncityPackageModel.collection.updateOne(
      { _id: pkg._id },
      { $set: { variants: converted } },
    );
    incityUpdated += 1;
  }

  const outstation = await OutstationPackageModel.collection
    .find<{
      _id: mongoose.Types.ObjectId;
      oneWayFarePaise?: number;
      driverCommissionBps?: number;
    }>({})
    .toArray();

  let outstationUpdated = 0;
  let outstationSkipped = 0;

  for (const band of outstation) {
    if (typeof band.driverCommissionBps !== 'number') {
      outstationSkipped += 1;
      continue;
    }

    await OutstationPackageModel.collection.updateOne(
      { _id: band._id },
      {
        $set: {
          driverAmountPaise: amountFrom(band.oneWayFarePaise ?? 0, band.driverCommissionBps),
        },
        $unset: { driverCommissionBps: '' },
      },
    );
    outstationUpdated += 1;
  }

  logger.info(
    { incityUpdated, incitySkipped, outstationUpdated, outstationSkipped },
    'migration complete',
  );
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'migration failed');
  process.exit(1);
});
