import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../shared/logging/logger.js';
import { CancellationChargeModel } from '../modules/bookings/infrastructure/charge.model.js';
import { WalletEntryModel } from '../modules/wallet/infrastructure/walletEntry.model.js';
import { BookingModel } from '../modules/bookings/infrastructure/booking.model.js';

/**
 * ONE-SHOT MIGRATION — unsettled cancellation fees become customer wallet rows.
 *
 * WHY IT IS NOT OPTIONAL. Before 2026-09-02 a customer's outstanding balance was
 * `sum(cancellationCharges where settledByPaymentId is null)`, read by `outstandingDues`. That
 * method is gone and the wallet is the single source now — so on any database carrying unsettled
 * fees, skipping this step quietly forgives every one of them.
 *
 * IDEMPOTENT, twice over. It skips a booking that already has a `CANCELLATION_FEE` row, and the
 * unique partial index on `(bookingId, entryType)` refuses a duplicate even if two copies run at
 * once. Running it again is safe and writes nothing.
 *
 * ONLY `chargedTo: 'CUSTOMER'` ROWS. A driver's cancellation penalty is a debit against their
 * EARNINGS in the driver ledger and has never been a customer's debt — migrating those into a
 * customer wallet would invent a charge against the wrong person.
 *
 *     pnpm --filter @driverzone/api exec tsx src/scripts/migrateDuesToWallet.ts
 */
async function main(): Promise<void> {
  await mongoose.connect(env.MONGO_URI);
  logger.info('connected — migrating unsettled cancellation fees into customer wallets');

  const unsettled = await CancellationChargeModel.find({
    chargedTo: 'CUSTOMER',
    settledByPaymentId: null,
  }).lean();

  logger.info({ found: unsettled.length }, 'unsettled customer cancellation fees');

  let written = 0;
  let skipped = 0;

  for (const charge of unsettled) {
    const existing = await WalletEntryModel.findOne({
      bookingId: charge.bookingId,
      entryType: 'CANCELLATION_FEE',
    });

    if (existing !== null) {
      skipped += 1;
      continue;
    }

    // Only for the note. A missing booking is not a reason to drop the debt.
    const booking = await BookingModel.findById(charge.bookingId).select('reference').lean();
    const reference = booking?.reference ?? String(charge.bookingId);

    await WalletEntryModel.create({
      customerId: charge.customerId,
      bookingId: charge.bookingId,
      entryType: 'CANCELLATION_FEE',
      // Stored POSITIVE on the charge row, owed by the customer, so negative in the wallet.
      amountPaise: -Math.abs(charge.amountPaise),
      note: `Cancellation fee for trip ${reference}`,
    });

    written += 1;
  }

  logger.info({ written, skipped }, 'migration complete');
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'migration failed');
  process.exit(1);
});
