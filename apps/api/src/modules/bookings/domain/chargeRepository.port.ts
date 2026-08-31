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
  chargedTo: 'CUSTOMER' | 'DRIVER';
  amountPaise: number;
  atStatus: BookingStatus;
  reason: string;
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
    chargedTo: CancellationCharge['chargedTo'];
    amountPaise: number;
    atStatus: BookingStatus;
    reason: string;
  }): Promise<CancellationCharge>;

  findCancellationCharge(bookingId: string): Promise<CancellationCharge | null>;

  recordPinReport(input: {
    bookingId: string;
    driverId: string;
    driverLocation: GeoPoint;
    pickupLocation: GeoPoint;
    distanceMetres: number;
    note?: string | undefined;
  }): Promise<void>;
}
