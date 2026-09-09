/**
 * PUBLIC CONTRACT — the only surface other modules may import from `pricing`.
 *
 * There is no container, no repository and no router here, and there never should be. `pricing`
 * is TIER 0 and PURE: plain data in, a breakdown out, no I/O, no clock reads, no database. That
 * is what lets the most dispute-prone logic in the product be exercised exhaustively in
 * milliseconds — every window boundary, every rounding edge, every commission rate — without a
 * Mongo instance anywhere near it.
 *
 * Consequently this module exports FUNCTIONS, not a contract object built by a container. A
 * caller imports them directly; there is no adapter to swap because there is nothing to swap.
 *
 * MONEY ARRIVES IN PAISE. `pricing` and `settings` are both tier 0 and same-tier imports are
 * forbidden (`.dependency-cruiser.cjs`), so this module cannot see the branded `Rupees` type or
 * `rupeesToPaise()`. The caller converts. That is not a workaround — it puts the unit crossing in
 * the module that read the setting, where it is one visible line per field, instead of burying it
 * inside the arithmetic.
 */

export {
  computeIncityFare,
  computeOutstationFare,
} from './domain/computeFare.js';

export { splitFare, assertFareReconciles } from './domain/splitFare.js';

export { surchargeFor } from './domain/surcharge.js';

export { inWindow, istCalendarDaysInclusive, istWallClockMinutes } from './domain/istClock.js';

export {
  computeWaitingCharge,
  computeDriverLateFine,
  computeCustomerCancellationFee,
  computeDriverCancellationPenalty,
} from './domain/charges.js';

export type {
  FareBreakdown,
  FareConfig,
  FareLine,
  FareLineCode,
  FareSplit,
  IncityFareInput,
  OutstationFareInput,
  PickupZoneFare,
} from './domain/fare.entity.js';

export { FARE_LINE_CODES } from './domain/fare.entity.js';

export type { Surcharge } from './domain/surcharge.js';

export type {
  CancellationConfig,
  CancellationContext,
  DriverLateConfig,
  DriverLateFine,
  WaitingCharge,
  WaitingConfig,
} from './domain/charges.js';
