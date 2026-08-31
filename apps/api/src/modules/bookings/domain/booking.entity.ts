import type {
  BookingActorType,
  BookingStatus,
  Direction,
  ServiceType,
  Terrain,
} from '@driverzone/contracts';
import type { FareBreakdown } from '../../pricing/pricing.public.js';

/**
 * DOMAIN — a booking, and the only legal ways it may move.
 *
 * INVARIANT B-3: every status change goes through one function, and no handler writes
 * `bookings.status` directly. That is what makes `bookingEvents` trustworthy — and the event log
 * is how every dispute, every "the driver never came" and every "I was charged for time I did not
 * use" gets answered eight weeks later.
 */

/**
 * Transcribed from docs/LLD/booking-lifecycle.md, with one change: `DRAFT` and `QUOTED` are gone
 * and `PENDING_PAYMENT` is the entry point.
 *
 * Those two described a customer who had not bought anything, and that state lives on the
 * `quotes` collection — a booking row now comes into existence only when there is money to
 * collect. Payment precedes confirmation, so a booking waits at `PENDING_PAYMENT` until the
 * gateway captures, and no driver is looked for before then.
 */
export const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'EXPIRED', 'CANCELLED_BY_CUSTOMER'],
  CONFIRMED: ['SEARCHING', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_ADMIN'],
  SEARCHING: ['ASSIGNED', 'NO_DRIVER_FOUND', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_ADMIN'],
  ASSIGNED: [
    'DRIVER_EN_ROUTE',
    'SEARCHING', // ← reassignment
    'CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_DRIVER',
    'CANCELLED_BY_ADMIN',
  ],
  DRIVER_EN_ROUTE: [
    'ARRIVED',
    'SEARCHING',
    'CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_DRIVER',
    'CANCELLED_BY_ADMIN',
  ],
  ARRIVED: [
    'STARTED',
    'SEARCHING',
    'CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_DRIVER',
    'CANCELLED_BY_ADMIN',
  ],
  STARTED: ['COMPLETED', 'CANCELLED_BY_ADMIN'], // admin only, and it is rare
  COMPLETED: [],
  NO_DRIVER_FOUND: ['SEARCHING'], // admin retry
  CANCELLED_BY_CUSTOMER: [],
  CANCELLED_BY_DRIVER: [],
  CANCELLED_BY_ADMIN: [],
  EXPIRED: [],
};

/**
 * Statuses that may not be reached without a reason.
 *
 * Every cancellation, `NO_DRIVER_FOUND`, and `SEARCHING` when it arrives from a reassignment. An
 * unexplained state change is one nobody can act on later — and these are precisely the ones
 * somebody will be asked about.
 */
export const REASON_REQUIRED: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN',
  'NO_DRIVER_FOUND',
]);

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A status from which nothing further can happen. */
export function isTerminal(status: BookingStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** The statuses in which a driver is committed to this trip and cannot take another. */
export const COMMITTED_STATUSES: readonly BookingStatus[] = [
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED',
  'STARTED',
];

export interface Actor {
  type: BookingActorType;
  /** Null for SYSTEM — a sweeper and a wave timeout have no person behind them. */
  id: string | null;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * What the customer agreed to, frozen at confirmation and never edited (invariant B-1).
 *
 * `source` records WHY this price was charged, which is what a dispute needs when the packages
 * have since been reorganised. Every later charge — waiting, a late fine, a cancellation fee — is
 * its own row elsewhere and never an edit here.
 */
export interface FareSnapshot {
  version: 1;
  serviceType: ServiceType;
  computedAt: Date;
  source: {
    packageId: string;
    packageName: string;
    variantId: string | null;
    variantLabel: string | null;
    pickupZoneId: string;
    pickupZoneName: string;
    cityZoneId: string | null;
    cityName: string | null;
    terrain: Terrain | null;
  };
  included: { minutes: number | null };
  fare: FareBreakdown;
}

export interface Booking {
  id: string;
  /** `DZ-8F3K2M`. What a customer reads out to support; never the ObjectId. */
  reference: string;
  customerId: string;
  driverId: string | null;
  status: BookingStatus;
  serviceType: ServiceType;

  pickup: GeoPoint;
  pickupAddress: string;
  drop: GeoPoint;
  dropAddress: string;
  direction: Direction | null;
  distanceKm: number | null;

  quoteId: string;
  fareSnapshot: FareSnapshot;
  paymentId: string | null;

  /** True when the pickup is far enough out that dispatch waits rather than searching now. */
  isScheduled: boolean;
  scheduledAt: Date;
  /** When dispatch should start looking. `now` for an immediate booking, T−lead for a scheduled one. */
  dispatchAt: Date;

  assignedAt: Date | null;
  enRouteAt: Date | null;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;

  /** Measured from ARRIVED to STARTED and settled after the trip. */
  waitingMinutes: number | null;
  waitingChargePaise: number | null;
  /** How late the driver was against `scheduledAt`. Recorded even when under the grace period. */
  driverLateMinutes: number | null;

  /** Wrong-OTP attempts. At five the booking locks and routes to support. */
  otpAttempts: number;

  createdAt: Date;
  updatedAt: Date;
}

/** Five wrong codes and the driver is talking to a human instead. */
export const MAX_OTP_ATTEMPTS = 5;

/**
 * A booking whose pickup is further out than this waits rather than dispatching immediately, and
 * earns the scheduled cancellation window.
 */
export const SCHEDULED_THRESHOLD_MINUTES = 60;

export function isScheduledBooking(scheduledAt: Date, now: Date): boolean {
  return scheduledAt.getTime() > now.getTime() + SCHEDULED_THRESHOLD_MINUTES * 60_000;
}

/**
 * `DZ-` plus six characters from an alphabet with no `0`/`O` and no `1`/`I`.
 *
 * These are read aloud down a phone line to support, which is the whole reason for the exclusions
 * and for using uppercase only.
 */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateReference(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += REFERENCE_ALPHABET[Math.floor(random() * REFERENCE_ALPHABET.length)];
  }
  return `DZ-${out}`;
}
