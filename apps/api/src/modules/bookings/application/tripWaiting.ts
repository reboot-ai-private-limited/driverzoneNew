import { rupeesToPaise, type SettingsReadContract } from '../../settings/settings.public.js';
import { computeWaitingCharge } from '../../pricing/pricing.public.js';
import type { Booking } from '../domain/booking.entity.js';

type SettingsSnapshot = Awaited<ReturnType<SettingsReadContract['snapshot']>>;

/**
 * The waiting charge on a trip: from the driver ARRIVING to the trip STARTING, beyond the free
 * minutes.
 *
 * ONE FUNCTION FOR TWO CALLERS, and that is the point of it. `completeTrip` books this charge at
 * the end; the driver's payment QR asks for it up front, once the trip has started and both times
 * are fixed. If the two ever computed it differently the QR would collect one figure and the trip
 * would then ask for another — so there is one place it is written.
 */
export function waitingChargeFor(
  booking: Booking,
  snapshot: SettingsSnapshot,
): { waitedMinutes: number; chargeableMinutes: number; amountPaise: number; capped: boolean } {
  if (booking.arrivedAt === null || booking.startedAt === null) {
    return { waitedMinutes: 0, chargeableMinutes: 0, amountPaise: 0, capped: false };
  }

  return computeWaitingCharge(booking.arrivedAt, booking.startedAt, {
    freeMinutes: snapshot['waiting.free_minutes'],
    chargePerMinutePaise: rupeesToPaise(snapshot['waiting.charge_per_minute']),
    maxChargePaise: rupeesToPaise(snapshot['waiting.max_charge']),
  });
}
