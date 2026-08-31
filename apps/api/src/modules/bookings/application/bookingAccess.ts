import { AppError } from '../../../shared/errors/AppError.js';
import type { Booking } from '../domain/booking.entity.js';
import { BookingNotFoundError, InvalidTransitionError } from '../domain/booking.errors.js';
import type { BookingRepositoryPort } from '../domain/bookingRepository.port.js';

/**
 * APPLICATION — the checks every booking use case starts with.
 *
 * Shared rather than repeated because the failure modes are subtle and getting one of them wrong
 * in one handler is how a driver ends up able to start somebody else's trip.
 */

/**
 * Loads a booking that this driver is actually assigned to.
 *
 * A booking belonging to a different driver is a 404, not a 403. A 403 confirms the booking
 * exists, which lets anyone with a driver token enumerate live trips by id — and there is nothing
 * a driver can do with the distinction anyway.
 */
export async function loadForDriver(
  repo: BookingRepositoryPort,
  bookingId: string,
  driverId: string,
): Promise<Booking> {
  const booking = await repo.findById(bookingId);
  if (booking === null || booking.driverId !== driverId) throw new BookingNotFoundError(bookingId);
  return booking;
}

export async function loadForCustomer(
  repo: BookingRepositoryPort,
  bookingId: string,
  customerId: string,
): Promise<Booking> {
  const booking = await repo.findById(bookingId);
  if (booking === null || booking.customerId !== customerId) {
    throw new BookingNotFoundError(bookingId);
  }
  return booking;
}

/**
 * Turns a lost compare-and-swap into the right error.
 *
 * `transition()` returns null when the booking was not in the expected status, which almost
 * always means somebody else moved it first — a customer cancelling as the driver taps Arrive.
 * Re-reading tells the caller what it actually is now, so the app can re-render rather than
 * showing a stale screen with an error on it.
 */
export async function explainLostTransition(
  repo: BookingRepositoryPort,
  booking: Booking,
  attempted: Booking['status'],
): Promise<never> {
  const current = await repo.findById(booking.id);
  if (current === null) throw new BookingNotFoundError(booking.id);
  throw new InvalidTransitionError(booking.reference, current.status, attempted);
}

/** A reason is required on every cancellation; an empty one is not a reason. */
export function requireReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? '';
  if (trimmed === '') {
    throw AppError.badRequest('A reason is required to cancel a booking.');
  }
  return trimmed;
}
