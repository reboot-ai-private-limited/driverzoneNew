import type { BookingStatus } from '@driverzone/contracts';

/**
 * A booking's status, read for the customer's trip screen.
 *
 * Mirrors `quote.ts`'s own rule for the same reason: `unavailableTitle`'s `default` branch is
 * load-bearing there, and `tripStatusCopy`'s is load-bearing here. `BOOKING_STATUSES` will grow —
 * a driver-side or admin-side transition this build predates must still render as SOMETHING
 * sensible, not fall through to a blank card.
 */

export interface StatusCopy {
  title: string;
  body: string;
  /** Which `Feather` glyph reads this status at a glance, on the status card. */
  icon: 'clock' | 'search' | 'user-check' | 'navigation' | 'flag' | 'check-circle' | 'x-circle';
}

export function tripStatusCopy(status: BookingStatus): StatusCopy {
  switch (status) {
    case 'PENDING_PAYMENT':
      return { title: 'Awaiting payment', body: 'Finishing up your payment.', icon: 'clock' };
    case 'CONFIRMED':
      return {
        title: 'Booking confirmed',
        body: "We're about to start looking for a driver.",
        icon: 'check-circle',
      };
    case 'SEARCHING':
      return {
        title: 'Finding your driver',
        body: 'This usually takes a couple of minutes.',
        icon: 'search',
      };
    case 'ASSIGNED':
      return {
        title: 'Driver assigned',
        body: 'Your driver is getting ready to head your way.',
        icon: 'user-check',
      };
    case 'DRIVER_EN_ROUTE':
      return {
        title: 'Driver on the way',
        body: 'Your driver is heading to pickup.',
        icon: 'navigation',
      };
    case 'ARRIVED':
      return {
        title: 'Driver has arrived',
        body: 'Read out your trip code to start the ride.',
        icon: 'flag',
      };
    case 'STARTED':
      return { title: 'Trip in progress', body: 'Enjoy your ride.', icon: 'navigation' };
    case 'COMPLETED':
      return { title: 'Trip complete', body: 'Thanks for riding with us.', icon: 'check-circle' };
    case 'CANCELLED_BY_CUSTOMER':
      return { title: 'You cancelled this trip', body: '', icon: 'x-circle' };
    case 'CANCELLED_BY_DRIVER':
      return {
        title: 'Cancelled by the driver',
        body: 'Sorry about that — you were not charged for the ride.',
        icon: 'x-circle',
      };
    case 'CANCELLED_BY_ADMIN':
      return {
        title: 'Trip cancelled',
        body: 'Our team stepped in and cancelled this one.',
        icon: 'x-circle',
      };
    case 'NO_DRIVER_FOUND':
      return {
        title: 'No driver was available',
        body: 'Nobody was free to take this trip. You were not charged.',
        icon: 'x-circle',
      };
    case 'EXPIRED':
      return { title: 'Booking expired', body: 'This one never went through.', icon: 'x-circle' };
    default:
      return { title: 'Trip update', body: 'Checking the latest status.', icon: 'clock' };
  }
}

/**
 * Once a booking reaches one of these, nothing about it changes again — so the trip screen stops
 * polling. `COMPLETED` and every `CANCELLED_*`/`NO_DRIVER_FOUND`/`EXPIRED` outcome are final;
 * everything else is a step the trip is still moving through.
 */
const TERMINAL_STATUSES: ReadonlySet<BookingStatus> = new Set([
  'COMPLETED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN',
  'NO_DRIVER_FOUND',
  'EXPIRED',
]);

export function isTerminalStatus(status: BookingStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Whether something is actively HAPPENING right now, as opposed to waiting or finished — the
 * trip screen's status icon pulses on this and holds still otherwise. Every non-terminal status
 * qualifies: even `PENDING_PAYMENT`/`CONFIRMED` are a process moving, not a state sitting idle,
 * and a pulse that stopped for those two would read as the screen having frozen.
 */
export function isLiveStatus(status: BookingStatus): boolean {
  return !isTerminalStatus(status);
}

/** The trip code is only worth showing while there is still a driver ahead of it to give it to. */
export function showsStartOtp(status: BookingStatus): boolean {
  return status === 'ASSIGNED' || status === 'DRIVER_EN_ROUTE' || status === 'ARRIVED';
}

/**
 * Whether the CUSTOMER may still cancel from here — mirrors `TRANSITIONS` in the API's
 * `booking.entity.ts` exactly: every status reaches `CANCELLED_BY_CUSTOMER` except `STARTED`
 * (the trip is already happening — cancelling a ride in progress is not a thing) and whatever is
 * already terminal. Kept as its own function rather than folded into `isTerminalStatus` because
 * the two questions differ by exactly one status.
 */
export function isCustomerCancellable(status: BookingStatus): boolean {
  return status !== 'STARTED' && !isTerminalStatus(status);
}

/**
 * Whether a driver is already attached to this booking.
 *
 * The cancel sheet is the only caller, and it needs this to offer reasons that are not nonsense:
 * "Driver is taking too long" while dispatch is still ringing phones names a driver who does not
 * exist, and "Taking too long to find a driver" once one has accepted blames the search for
 * something the driver is doing.
 */
export function hasDriverAssigned(status: BookingStatus): boolean {
  return status === 'ASSIGNED' || status === 'DRIVER_EN_ROUTE' || status === 'ARRIVED';
}
