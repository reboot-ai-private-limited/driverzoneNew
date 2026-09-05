import type { BookingStatus, SettingValue } from '@driverzone/contracts';

/**
 * What it costs a driver to drop a trip, and the reasons they may give for it.
 *
 * **The penalty is mirrored from the server, not invented here.** `computeDriverCancellationPenalty`
 * in `apps/api/.../pricing/domain/charges.ts` is three lines and reads two settings, both of which
 * are declared visible to the DRIVER audience precisely so this screen can state the figure before
 * the driver commits. The server remains the authority — what it returns in `CancelBookingResponse.fee`
 * is what was actually taken — and this exists only so the confirm sheet is not asking someone to
 * agree to a number nobody has shown them.
 *
 * If the two ever disagree, the server wins and the sheet is wrong; that is why the sheet renders
 * the real figure afterwards rather than assuming its own preview was right.
 */

/** The statuses the state machine actually permits a driver cancellation from (`TRANSITIONS`). */
const CANCELLABLE: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED',
]);

/**
 * STARTED IS ABSENT, deliberately. The customer is in the car by then and only an admin may end
 * the trip — offering a button here would be offering one that can only return an error.
 */
export function isDriverCancellable(status: BookingStatus): boolean {
  return CANCELLABLE.has(status);
}

/** Settings are rupees on the wire; the rest of the app counts in paise. */
function rupeesToPaise(value: SettingValue | undefined): number {
  return typeof value === 'number' ? Math.round(value * 100) : 0;
}

/**
 * The penalty for cancelling at this status, in paise.
 *
 * NO FREE WINDOW, unlike the customer's ladder: a driver who accepted has already taken the
 * booking out of dispatch whatever the clock says, so time does not enter into it. `ASSIGNED` is
 * free because nothing has been promised to the customer yet beyond a name.
 *
 * Returns 0 when the settings have not loaded, and the sheet distinguishes that from a genuine
 * zero — "no penalty" and "we could not check" must not look the same on a screen about money.
 */
export function driverPenaltyPaise(
  status: BookingStatus,
  settings: Record<string, SettingValue> | undefined,
): number {
  if (settings === undefined) return 0;
  if (status === 'DRIVER_EN_ROUTE') {
    return rupeesToPaise(settings['cancellation.driver_penalty_en_route']);
  }
  if (status === 'ARRIVED') return rupeesToPaise(settings['cancellation.driver_penalty_arrived']);
  return 0;
}

/**
 * The reasons offered, as things that are actually true rather than a single "Other".
 *
 * A free-text box alone gets "cant" typed into it a thousand times and tells ops nothing; a fixed
 * list that omits the real reason gets the nearest wrong one picked. So: the common cases, plus a
 * note the driver may add to any of them — `reason` goes to the customer's own cancellation
 * message and into the ledger row, so it has to read like a sentence.
 */
export const CANCEL_REASONS: readonly string[] = [
  'Vehicle broke down',
  'Customer is not reachable',
  'Customer asked me to cancel',
  'Pickup is too far away',
  'Personal emergency',
  'Something else',
];
