import { timingSafeEqual } from 'node:crypto';
import { logger } from '../../../../shared/logging/logger.js';
import { rupeesToPaise, type SettingsReadContract } from '../../../settings/settings.public.js';
import { computeWaitingCharge } from '../../../pricing/pricing.public.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import { MAX_OTP_ATTEMPTS, type Booking, type GeoPoint } from '../../domain/booking.entity.js';
import { InvalidOtpError, OtpLockedError } from '../../domain/booking.errors.js';
import { distanceMetres } from '../../domain/distance.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import { explainLostTransition, loadForDriver } from '../bookingAccess.js';

export interface StartTripInput {
  bookingId: string;
  driverId: string;
  otp: string;
  /** Optional — the check here only warns, so a missing fix is not a reason to refuse. */
  location?: GeoPoint | undefined;
}

/**
 * Starts the trip, once the customer has read out their code.
 *
 * WHY THE OTP EXISTS AT ALL: without it drivers mark trips started while still driving over, and
 * since the trip clock runs from `startedAt`, every minute of that is billed to a customer who is
 * not in the car yet. It is one of the highest-yield twenty lines in the product.
 *
 * THE GEOFENCE HERE ONLY WARNS, unlike the one on Arrive. By this point the customer is sitting
 * in the car, and refusing to start a trip that is demonstrably happening strands both of them
 * over a GPS reading. The override is recorded instead; a driver with many of them is worth
 * looking at.
 */
export class StartTripUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly settings: SettingsReadContract,
    private readonly notifications: NotificationsContract,
  ) {}

  async execute(input: StartTripInput): Promise<Booking> {
    const booking = await loadForDriver(this.repo, input.bookingId, input.driverId);

    if (booking.otpAttempts >= MAX_OTP_ATTEMPTS) throw new OtpLockedError();

    const expected = await this.repo.readStartOtp(booking.id);
    if (expected === null || !constantTimeEquals(expected, input.otp)) {
      /*
       * COUNTED BEFORE IT IS JUDGED — the increment happens on the failure path regardless of
       * why the comparison failed, so a caller cannot spend attempts for free by sending
       * malformed input.
       */
      const attempts = await this.repo.incrementOtpAttempts(booking.id);
      if (attempts >= MAX_OTP_ATTEMPTS) throw new OtpLockedError();
      throw new InvalidOtpError(MAX_OTP_ATTEMPTS - attempts);
    }

    const now = new Date();
    const snapshot = await this.settings.snapshot();

    const metadata: Record<string, unknown> = {};
    if (input.location !== undefined) {
      const away = distanceMetres(input.location, booking.pickup);
      metadata['distanceMetres'] = away;

      if (away > snapshot['dispatch.start_warn_radius_m']) {
        // Allowed, and recorded. GPS drifts badly near tall buildings and a hard block would
        // strand a legitimate driver — but a pattern of these is worth someone's attention.
        metadata['startedAwayFromPickup'] = true;
        logger.warn(
          { bookingId: booking.id, driverId: input.driverId, away },
          'trip started away from the pickup point',
        );
      }
    }

    /*
     * THE WAITING CHARGE IS KNOWN THE MOMENT THE TRIP STARTS — the clock is ARRIVED to STARTED, and
     * both ends are fixed now. Recorded here rather than only at completion so that, for the whole
     * trip, `payable.waiting_total` already says what it is: the driver can be told "collect ₹60
     * for waiting" before they end the trip, and the customer sees it on their bill in advance.
     * `CompleteTripUseCase` recomputes from the same two instants, so the figure cannot move.
     */
    const waiting =
      booking.arrivedAt === null
        ? { waitedMinutes: 0, amountPaise: 0 }
        : computeWaitingCharge(booking.arrivedAt, now, {
            freeMinutes: snapshot['waiting.free_minutes'],
            chargePerMinutePaise: rupeesToPaise(snapshot['waiting.charge_per_minute']),
            maxChargePaise: rupeesToPaise(snapshot['waiting.max_charge']),
          });

    const started = await this.repo.transition({
      bookingId: booking.id,
      from: 'ARRIVED',
      to: 'STARTED',
      actor: { type: 'DRIVER', id: input.driverId },
      metadata,
      patch: {
        startedAt: now,
        waitingMinutes: waiting.waitedMinutes,
        waitingChargePaise: waiting.amountPaise,
      },
    });

    if (started === null) return explainLostTransition(this.repo, booking, 'STARTED');

    await this.notifications.sendBookingUpdate(
      { role: 'CUSTOMER', id: booking.customerId },
      {
        bookingId: booking.id,
        reference: booking.reference,
        status: 'STARTED',
        message: 'Your trip has started. Have a safe journey.',
      },
    );

    return started;
  }
}

/**
 * Constant-time, and length-checked first because `timingSafeEqual` throws on a length mismatch
 * rather than returning false.
 *
 * The timing protection is admittedly thin for a four-digit code — but it costs one line, and the
 * habit is worth more than the guarantee.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
