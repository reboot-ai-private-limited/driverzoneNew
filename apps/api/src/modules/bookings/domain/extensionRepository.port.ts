import type { BookingExtension, ExtensionStatus } from './bookingExtension.entity.js';

export interface NewExtension {
  bookingId: string;
  customerId: string;
  driverId: string;
  amountPaise: number;
  driverAmountPaise: number;
  expiresAt: Date;
}

export interface ExtensionRepositoryPort {
  /**
   * Opens a request.
   *
   * Refused by a partial unique index when this booking already has a PENDING one — two taps of
   * Extend must not become two days. The implementation reports that as `null` rather than
   * throwing, because it is a normal double-submit and not a fault.
   */
  open(input: NewExtension): Promise<BookingExtension | null>;

  /** The one still waiting on the driver, or null. */
  findPending(bookingId: string): Promise<BookingExtension | null>;

  /** Every extension on a booking, whatever its status — the receipt reads the accepted ones. */
  listForBooking(bookingId: string): Promise<BookingExtension[]>;

  /**
   * Answers a pending request, but only if it is still PENDING and unexpired.
   *
   * A compare-and-swap, for the same reason `dispatch`'s `respond` is one: a driver tapping
   * Accept as the sweep expires the request must resolve to exactly one outcome, not to an accept
   * applied on top of a lapse.
   */
  respond(
    extensionId: string,
    to: Extract<ExtensionStatus, 'ACCEPTED' | 'DECLINED'>,
    now: Date,
  ): Promise<BookingExtension | null>;

  /** The sweep: marks every request whose window closed. Returns how many. */
  expireStale(now: Date, limit: number): Promise<number>;
}
