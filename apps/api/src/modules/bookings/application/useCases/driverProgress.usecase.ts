import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { Booking, GeoPoint } from '../../domain/booking.entity.js';
import { BookingNotFoundError } from '../../domain/booking.errors.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { ChargeRepositoryPort } from '../../domain/chargeRepository.port.js';
import { distanceMetres } from '../../domain/distance.js';
import { explainLostTransition, loadForDriver } from '../bookingAccess.js';

/**
 * The driver has set off.
 *
 * Small, and worth its own transition rather than being folded into acceptance: this is the point
 * the cancellation ladder starts costing a customer money, so the moment it happened has to be a
 * recorded fact rather than an inference from a location trace.
 */
export class DriverEnRouteUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(bookingId: string, driverId: string): Promise<Booking> {
    const booking = await loadForDriver(this.repo, bookingId, driverId);

    const enRoute = await this.repo.transition({
      bookingId,
      from: 'ASSIGNED',
      to: 'DRIVER_EN_ROUTE',
      actor: { type: 'DRIVER', id: driverId },
      patch: { enRouteAt: new Date() },
    });

    if (enRoute === null) return explainLostTransition(this.repo, booking, 'DRIVER_EN_ROUTE');

    await this.notifications.sendBookingUpdate(
      { role: 'CUSTOMER', id: booking.customerId },
      {
        bookingId: booking.id,
        reference: booking.reference,
        status: 'DRIVER_EN_ROUTE',
        message: 'Your driver is on the way.',
      },
    );

    return enRoute;
  }
}

export interface ReportPinInput {
  bookingId: string;
  driverId: string;
  location: GeoPoint;
  note?: string | undefined;
}

/**
 * "I am here and the pin is not."
 *
 * The way out of the arrival gate, and deliberately not a self-serve override. At 500 m a
 * refusal is usually a customer who dropped the pin on the wrong side of a flyover rather than a
 * drifting GPS, and an override button would silently absorb that forever — the same customers
 * would keep mis-pinning and every driver after would lose the same ten minutes.
 *
 * Routing it to ops fixes the trip AND accumulates a record of which pins are wrong. It changes
 * no status: the booking stays where it was, and an admin either moves the pin or force-arrives it.
 */
export class ReportPickupPinUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly charges: ChargeRepositoryPort,
  ) {}

  async execute(input: ReportPinInput): Promise<{ distanceMetres: number }> {
    const booking = await loadForDriver(this.repo, input.bookingId, input.driverId);
    const away = distanceMetres(input.location, booking.pickup);

    await this.charges.recordPinReport({
      bookingId: booking.id,
      driverId: input.driverId,
      driverLocation: input.location,
      pickupLocation: booking.pickup,
      distanceMetres: away,
      ...(input.note === undefined ? {} : { note: input.note }),
    });

    return { distanceMetres: away };
  }
}

/**
 * An admin marks a driver arrived when the gate refused them.
 *
 * The resolution of a pin report, and the only path that reaches ARRIVED without a location
 * check. It requires a reason, and the event log records that it was an admin rather than the
 * driver who moved it — so a driver accumulating these is visible even though each one was
 * legitimate.
 */
export class ForceArriveUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(bookingId: string, adminId: string, reason: string): Promise<Booking> {
    const booking = await this.repo.findById(bookingId);
    if (booking === null) throw new BookingNotFoundError(bookingId);

    const arrived = await this.repo.transition({
      bookingId,
      from: booking.status,
      to: 'ARRIVED',
      actor: { type: 'ADMIN', id: adminId },
      reason,
      metadata: { forced: true, bypassedArrivalRadius: true },
      patch: { arrivedAt: new Date() },
    });

    if (arrived === null) return explainLostTransition(this.repo, booking, 'ARRIVED');

    await this.notifications.sendBookingUpdate(
      { role: 'CUSTOMER', id: booking.customerId },
      {
        bookingId: booking.id,
        reference: booking.reference,
        status: 'ARRIVED',
        message: 'Your driver has arrived.',
      },
    );

    return arrived;
  }
}
