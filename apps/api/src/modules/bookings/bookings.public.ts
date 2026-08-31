import type { Booking } from './domain/booking.entity.js';

/**
 * PUBLIC CONTRACT — the only surface other modules may import from `bookings`.
 *
 * `dispatch` is the consumer, and the split below is the point. It may READ a booking and it may
 * CLAIM one for a driver — and it may do nothing else, in particular nothing that moves a booking
 * through the trip. `dispatch` is also the ONLY module permitted to set `bookings.driverId`, a
 * rule `.dependency-cruiser.cjs` enforces by tier and this interface enforces by shape.
 */

/** The outcome of a driver accepting an offer. Losing is a normal result, not an error. */
export type ClaimResult =
  | { claimed: true; booking: Booking }
  /**
   * Another driver won. This must NEVER count against the loser's acceptance rate — they did
   * everything right and were merely slower.
   */
  | { claimed: false; reason: 'ALREADY_ASSIGNED' }
  | { claimed: false; reason: 'NOT_SEARCHING' }
  | { claimed: false; reason: 'NOT_FOUND' };

export interface BookingDispatchContract {
  findById(bookingId: string): Promise<Booking | null>;

  /** Moves CONFIRMED → SEARCHING when the dispatch job fires. */
  beginSearching(bookingId: string): Promise<Booking | null>;

  /**
   * The accept race, as one conditional update: `driverId: null` AND `status: SEARCHING` are both
   * in the filter, so exactly one of five simultaneous accepts can win.
   */
  claimForDriver(bookingId: string, driverId: string): Promise<ClaimResult>;

  /** No driver was found after every wave. Requires a reason, like every terminal state. */
  markNoDriverFound(bookingId: string, reason: string): Promise<Booking | null>;

  /** Bookings whose dispatch time has passed and are still waiting — the sweeper's safety net. */
  findDueForDispatch(now: Date, limit: number): Promise<Booking[]>;
}

export type BookingsPublicContract = BookingDispatchContract;

export type { Booking, FareSnapshot, GeoPoint } from './domain/booking.entity.js';
export { COMMITTED_STATUSES } from './domain/booking.entity.js';
