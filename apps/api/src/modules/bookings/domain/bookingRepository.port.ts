import type { BookingStatus } from '@driverzone/contracts';
import type { Actor, Booking, FareSnapshot, GeoPoint } from './booking.entity.js';

export interface NewBooking {
  reference: string;
  customerId: string;
  quoteId: string;
  serviceType: Booking['serviceType'];
  pickup: GeoPoint;
  pickupAddress: string;
  drop: GeoPoint;
  dropAddress: string;
  direction: Booking['direction'];
  distanceKm: number | null;
  fareSnapshot: FareSnapshot;
  isScheduled: boolean;
  scheduledAt: Date;
  dispatchAt: Date;
  /** Hashed before storage is NOT wanted here — see `booking.model.ts` on why it is plaintext. */
  startOtp: string;
}

export interface BookingEvent {
  id: string;
  bookingId: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  actorType: Actor['type'];
  actorId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** Fields a transition may set alongside the status. Nothing else may be written with one. */
export interface TransitionPatch {
  driverId?: string | null;
  assignedAt?: Date;
  enRouteAt?: Date;
  arrivedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  waitingMinutes?: number;
  waitingChargePaise?: number;
  driverLateMinutes?: number;
  paymentId?: string;
}

export interface BookingRepositoryPort {
  create(data: NewBooking): Promise<Booking>;

  findById(id: string): Promise<Booking | null>;
  findByQuoteId(quoteId: string): Promise<Booking | null>;
  findByPaymentId(paymentId: string): Promise<Booking | null>;
  listForCustomer(customerId: string, limit: number): Promise<Booking[]>;

  /**
   * Reads the OTP, which every other read deliberately cannot see (`select: false` on the field).
   * Separate method so that reaching for it is a visible act at the call site.
   */
  readStartOtp(id: string): Promise<string | null>;

  incrementOtpAttempts(id: string): Promise<number>;

  /**
   * Links the booking to the payment being collected for it.
   *
   * Not part of `transition()` because it changes no status — the booking is at PENDING_PAYMENT
   * before and after. B-3 governs the status field alone.
   */
  attachPayment(id: string, paymentId: string): Promise<void>;

  /**
   * THE ONE WAY A STATUS CHANGES (invariant B-3).
   *
   * Compare-and-swap on `from`, plus the `bookingEvents` insert, in one multi-document
   * transaction. Returns `null` when the booking was not in `from` — someone else moved it first,
   * which is the ordinary result of a customer cancelling as a driver accepts, not an error.
   *
   * The docs write this in Postgres with `SELECT … FOR UPDATE`; a conditional update is the
   * better primitive here, since it holds no lock and cannot deadlock.
   */
  transition(input: {
    bookingId: string;
    from: BookingStatus;
    to: BookingStatus;
    actor: Actor;
    reason?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    patch?: TransitionPatch | undefined;
  }): Promise<Booking | null>;

  /**
   * THE ACCEPT RACE. `driverId: null` and `status: 'SEARCHING'` are both in the FILTER, so five
   * drivers tapping Accept at once produce exactly one winner and four clean losses.
   *
   * Separate from `transition()` because it swaps on two fields rather than one, and because it
   * is the single place invariant B-2 lives: `driverId` goes from null to non-null exactly once.
   * Returns `null` when the race was lost.
   */
  claimForDriver(bookingId: string, driverId: string): Promise<Booking | null>;

  listEvents(bookingId: string): Promise<BookingEvent[]>;

  /** Bookings whose `dispatchAt` has passed and are still waiting. The sweeper's safety net. */
  findDueForDispatch(now: Date, limit: number): Promise<Booking[]>;

  /** Bookings stuck at PENDING_PAYMENT past a cutoff, for expiry. */
  findAbandonedPayments(before: Date, limit: number): Promise<Booking[]>;
}
