import { rupeesToPaise, type SettingsReadContract } from '../../../settings/settings.public.js';
import { computeDriverLateFine } from '../../../pricing/pricing.public.js';
import type { LedgerWriteContract } from '../../../ledger/ledger.public.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { Booking, GeoPoint } from '../../domain/booking.entity.js';
import { DriverNotAtPickupError, StaleLocationError } from '../../domain/booking.errors.js';
import { distanceMetres, isFixStale } from '../../domain/distance.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import { explainLostTransition, loadForDriver } from '../bookingAccess.js';

export interface DriverArrivedInput {
  bookingId: string;
  driverId: string;
  location: GeoPoint;
  /** When the fix was taken on the device. A stale one is refused rather than trusted. */
  fixTakenAt: Date;
}

/**
 * The driver says they are at the pickup point, and we check.
 *
 * THIS IS THE ONE GATE IN THE FLOW THAT BLOCKS. Reaching ARRIVED starts the waiting-charge clock,
 * so a driver who can mark it from the highway can bill a customer for time nobody spent waiting.
 * Trip START keeps the documented warn-and-log behaviour instead, because by then the customer is
 * in the car and refusing would strand a trip that is genuinely happening.
 *
 * At the shipped 500 m radius, a refusal is rarely GPS drift — somebody 500 m away is not at the
 * pickup. It is far more often a customer who dropped the pin on the wrong side of a flyover,
 * which is why the escape hatch is `reportPickupPin` to ops rather than a self-serve override
 * button that would quietly absorb the same problem forever.
 */
export class DriverArrivedUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly settings: SettingsReadContract,
    private readonly ledger: LedgerWriteContract,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(input: DriverArrivedInput): Promise<Booking> {
    const booking = await loadForDriver(this.repo, input.bookingId, input.driverId);
    const now = new Date();

    /*
     * A four-minute-old fix taken on a motorway is several kilometres from where the device is
     * now, and accepting it is exactly how a driver "arrives" without arriving. Refusing is safe:
     * the app can take a fresh one and retry immediately.
     */
    if (isFixStale(input.fixTakenAt, now)) throw new StaleLocationError();

    const snapshot = await this.settings.snapshot();
    const allowedMetres = snapshot['dispatch.arrival_radius_m'];
    const away = distanceMetres(input.location, booking.pickup);

    if (away > allowedMetres) {
      logger.info(
        { bookingId: booking.id, driverId: input.driverId, away, allowedMetres },
        'arrival refused — driver is not at the pickup point',
      );
      throw new DriverNotAtPickupError(away, allowedMetres);
    }

    // ── The driver late fine ────────────────────────────────────────────────────────────────
    const lateFine = computeDriverLateFine(booking.scheduledAt, now, {
      graceMinutes: snapshot['driver.late_grace_minutes'],
      finePaise: rupeesToPaise(snapshot['driver.late_fine']),
    });

    const arrived = await this.repo.transition({
      bookingId: booking.id,
      from: booking.status,
      to: 'ARRIVED',
      actor: { type: 'DRIVER', id: input.driverId },
      metadata: {
        distanceMetres: away,
        lateMinutes: lateFine.lateMinutes,
        // Recorded whether or not it was charged, so a pattern of near-misses is visible.
        lateFinePaise: lateFine.amountPaise,
      },
      patch: { arrivedAt: now, driverLateMinutes: lateFine.lateMinutes },
    });

    if (arrived === null) return explainLostTransition(this.repo, booking, 'ARRIVED');

    /*
     * A LEDGER DEBIT AGAINST THE DRIVER, never a line on the customer's fare — the settings
     * registry says so in as many words. The customer's price is frozen, and a late driver does
     * not change it; compensating them is a goodwill decision for support, not something the
     * system issues off a timestamp.
     *
     * After the commit, and tolerant of failure: a booking that reached ARRIVED must not be
     * rolled back because a fine could not be written.
     */
    if (lateFine.amountPaise > 0) {
      try {
        await this.ledger.append([
          {
            driverId: input.driverId,
            bookingId: booking.id,
            entryType: 'PENALTY',
            amountPaise: -lateFine.amountPaise,
            note: `Arrived ${lateFine.lateMinutes} minutes after the scheduled time on ${booking.reference}`,
          },
        ]);
      } catch (error) {
        logger.error({ err: error, bookingId: booking.id }, 'could not record the driver late fine');
      }
    }

    await this.notifications.sendBookingUpdate(
      { role: 'CUSTOMER', id: booking.customerId },
      {
        bookingId: booking.id,
        reference: booking.reference,
        status: 'ARRIVED',
        message: `Your driver has arrived. Free waiting time is ${snapshot['waiting.free_minutes']} minutes.`,
      },
    );

    return arrived;
  }
}
