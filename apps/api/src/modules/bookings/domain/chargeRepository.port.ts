import type { BookingStatus } from '@driverzone/contracts';
import type { GeoPoint } from './booking.entity.js';

export interface FareAdjustment {
  id: string;
  bookingId: string;
  type: 'WAITING_CHARGE';
  amountPaise: number;
  label: string;
  settledByPaymentId: string | null;
}

export interface CancellationCharge {
  id: string;
  bookingId: string;
  customerId: string;
  chargedTo: 'CUSTOMER' | 'DRIVER';
  amountPaise: number;
  atStatus: BookingStatus;
  reason: string;
  settledByPaymentId: string | null;
}

/**
 * Everything charged after the quote was frozen.
 *
 * Kept off `BookingRepositoryPort` because these are a different lifecycle: a booking is written
 * once and transitioned, while these are appended as facts about it. Splitting them also means a
 * use case that only settles money cannot accidentally move a status.
 */
export interface ChargeRepositoryPort {
  /**
   * Records an adjustment, or returns the existing one if this booking already has that type.
   *
   * Idempotent because completion side effects run after the transaction commits and may be
   * retried — charging the waiting time twice for one crash is exactly what this prevents.
   */
  recordAdjustment(input: {
    bookingId: string;
    type: FareAdjustment['type'];
    amountPaise: number;
    label: string;
  }): Promise<FareAdjustment>;

  markAdjustmentsSettled(bookingId: string, paymentId: string): Promise<void>;
  listAdjustments(bookingId: string): Promise<FareAdjustment[]>;

  /** One per booking, idempotently — a cancellation cannot be charged for twice. */
  recordCancellationCharge(input: {
    bookingId: string;
    customerId: string;
    chargedTo: CancellationCharge['chargedTo'];
    amountPaise: number;
    atStatus: BookingStatus;
    reason: string;
    /** Set when the fee was collected as it was charged — kept back out of a refund. */
    settledByPaymentId?: string | undefined;
  }): Promise<CancellationCharge>;

  findCancellationCharge(bookingId: string): Promise<CancellationCharge | null>;

  /**
   * What this customer still owes, from fees charged on bookings that held none of their money.
   *
   * Only ever non-zero after a CASH cancellation: a prepaid booking's fee is kept out of its own
   * refund, so it is settled the instant it is charged.
   */
  outstandingDues(customerId: string): Promise<number>;

  /** Marks every unpaid due as collected by this payment. Called when its capture lands. */
  settleDues(customerId: string, paymentId: string): Promise<void>;

  recordPinReport(input: {
    bookingId: string;
    driverId: string;
    driverLocation: GeoPoint;
    pickupLocation: GeoPoint;
    distanceMetres: number;
    note?: string | undefined;
  }): Promise<void>;
}
