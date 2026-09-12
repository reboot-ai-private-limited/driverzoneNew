import type { BookingDto } from '@driverzone/contracts';

/**
 * The non-visual rules behind `BookingActions.tsx`'s transfer dialog, pulled out so they can be
 * unit-tested without rendering anything — `apps/web/vitest.config.ts` runs this app's tests
 * under `node`, not `jsdom`, on purpose (see its own comment: component snapshots fail on every
 * legitimate change and pass on every regression that does not alter markup). Same convention as
 * `lib/status.ts`.
 */

/**
 * Where a driver can still be moved or added.
 *
 * `STARTED` is absent and that is the rule, not an oversight — see `REASSIGNABLE_STATUSES` in the
 * API: moving a running trip is a cancellation plus a new booking. `SEARCHING` is present for the
 * other half of manual assignment — dispatch is still looking and ops has found somebody by phone.
 *
 * `CONFIRMED` IS PRE-ASSIGNMENT: a booking scheduled for later that dispatch will not ring for
 * until T−90. Ops usually knows days ahead who should take an early-morning outstation run, and
 * naming them now is better than hoping the automatic search finds somebody at 4:30am.
 */
export const TRANSFERABLE_STATUSES = new Set<BookingDto['status']>([
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED',
  'SEARCHING',
  'CONFIRMED',
]);

export function canTransfer(status: BookingDto['status']): boolean {
  return TRANSFERABLE_STATUSES.has(status);
}

/** The submit button stays disabled until a driver is picked and a reason is typed. */
export function isTransferSubmitDisabled(input: {
  selected: string | null;
  reason: string;
  isPending: boolean;
}): boolean {
  return input.selected === null || input.reason.trim().length === 0 || input.isPending;
}

/** The trimmed payload `useAssignDriver` sends — trimming happens once, here, not at the call site. */
export function buildAssignPayload(input: {
  bookingId: string;
  driverId: string;
  reason: string;
}): { id: string; driverId: string; reason: string } {
  return { id: input.bookingId, driverId: input.driverId, reason: input.reason.trim() };
}

/**
 * The dialog's title and description, which read differently depending on whether anybody has the
 * trip yet — and, when nobody does, on whether there is a search to bypass at all.
 *
 * THE THIRD CASE IS NOT A WORDING PREFERENCE. "Bypassing the search" is a lie on a `CONFIRMED`
 * booking: no search is running, none will until T−90, and an admin told they are overriding a
 * live hunt for a driver will hesitate over exactly the routine action this exists to make easy.
 */
export function transferDialogCopy(
  driver: BookingDto['driver'],
  status?: BookingDto['status'],
): {
  title: string;
  description: string;
} {
  if (driver === null && status === 'CONFIRMED') {
    return {
      title: 'Assign a driver now',
      description:
        'Nobody is being rung for this trip yet — dispatch starts closer to the pickup time. Assigning now books this driver for it.',
    };
  }

  if (driver === null) {
    return {
      title: 'Assign a driver',
      description: 'Hand this booking straight to a driver, bypassing the search.',
    };
  }

  return {
    title: 'Transfer to another driver',
    description: `${driver.name ?? 'The current driver'} is released and told why. They are not penalised.`,
  };
}
