import { logger } from '../../../../shared/logging/logger.js';
import { rupeesToPaise, type SettingsReadContract } from '../../../settings/settings.public.js';
import type { BookingDispatchContract } from '../../../bookings/bookings.public.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import { radiusForWave, rankCandidates } from '../../domain/offer.entity.js';
import type { DriverPoolPort, NewOffer, OfferRepositoryPort } from '../../domain/ports.js';

/** Schedules the wave-timeout job. Injected so the domain never imports BullMQ. */
export type WaveTimeoutScheduler = (input: {
  bookingId: string;
  wave: number;
  delayMs: number;
}) => Promise<void>;

export type WaveOutcome =
  | { rang: true; wave: number; driverCount: number }
  | { rang: false; reason: 'NO_CANDIDATES' | 'NOT_SEARCHING' | 'NOT_FOUND' | 'GAVE_UP' };

/**
 * Rings one wave of drivers.
 *
 * THE TIMER IS NEVER A `setTimeout`. A wave's TTL has to survive a deploy, and an in-memory timer
 * does not — a booking whose timeout died with the process is exactly the "silently hangs with no
 * driver" failure this module exists to prevent. The scheduler injected here is BullMQ, with a
 * deterministic job id so enqueueing twice is harmless.
 *
 * WIDENING IS IMMEDIATE WHEN NOBODY IS FOUND. A wave with no candidates does not sit out its TTL
 * ringing nobody; it goes straight to the next radius. Only a wave that actually rang someone
 * spends the time.
 */
export class RunDispatchWaveUseCase {
  constructor(
    private readonly offers: OfferRepositoryPort,
    private readonly pool: DriverPoolPort,
    private readonly bookings: BookingDispatchContract,
    private readonly settings: SettingsReadContract,
    private readonly notifications: NotificationsContract,
    private readonly scheduleTimeout: WaveTimeoutScheduler,
  ) {}

  async execute(bookingId: string, startWave = 1): Promise<WaveOutcome> {
    const booking = await this.bookings.findById(bookingId);
    if (booking === null) return { rang: false, reason: 'NOT_FOUND' };

    // The first wave is what moves a booking out of CONFIRMED. Later waves find it already there.
    if (booking.status === 'CONFIRMED') await this.bookings.beginSearching(bookingId);

    const current = await this.bookings.findById(bookingId);
    if (current === null) return { rang: false, reason: 'NOT_FOUND' };
    if (current.status !== 'SEARCHING') {
      // Someone accepted, or the customer cancelled, between the job firing and now. Normal.
      return { rang: false, reason: 'NOT_SEARCHING' };
    }

    const snapshot = await this.settings.snapshot();
    const maxWaves = snapshot['dispatch.max_waves'];
    const ttlSeconds = snapshot['dispatch.offer_ttl_seconds'];
    const waveSize = snapshot['dispatch.wave_size'];

    const alreadyOffered = await this.offers.driverIdsOffered(bookingId);

    for (let wave = startWave; wave <= maxWaves; wave += 1) {
      const radiusMetres = radiusForWave(wave, snapshot['dispatch.wave_base_radius_m']);

      const candidates = await this.pool.findEligible({
        pickup: current.pickup,
        radiusMetres,
        requireHillVerified: current.fareSnapshot.source.terrain === 'HILL',
        excludeDriverIds: alreadyOffered,
        maxNegativeBalancePaise: rupeesToPaise(snapshot['driver.max_negative_balance']),
        now: new Date(),
      });

      if (candidates.length === 0) {
        logger.info({ bookingId, wave, radiusMetres }, 'no eligible drivers — widening immediately');
        continue;
      }

      const chosen = rankCandidates(candidates, radiusMetres).slice(0, waveSize);
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      const created = await this.offers.createMany(
        chosen.map(
          (candidate): NewOffer => ({
            bookingId,
            driverId: candidate.driverId,
            wave,
            score: candidate.score,
            distanceMetres: candidate.distanceMetres,
            expiresAt,
          }),
        ),
      );

      /*
       * Rung one at a time and tolerant of failure. A stale device token must not abandon the
       * whole wave — the others still need ringing, and the driver who could not be reached is
       * recorded as `NONE` so the lapse is attributed to us rather than to them.
       */
      await Promise.all(
        created.map(async (offer) => {
          try {
            const via = await this.notifications.sendOffer(offer.driverId, {
              offerId: offer.id,
              bookingId,
              reference: current.reference,
              expiresAt,
              earningPaise: current.fareSnapshot.fare.split.driverPaise,
              pickupAddress: current.pickupAddress,
              scheduledAt: current.scheduledAt,
              serviceType: current.serviceType,
            });
            await this.offers.recordDelivery(offer.id, via);
          } catch (error) {
            logger.warn({ err: error, offerId: offer.id }, 'could not deliver an offer');
            await this.offers.recordDelivery(offer.id, 'NONE');
          }
        }),
      );

      await this.scheduleTimeout({ bookingId, wave, delayMs: ttlSeconds * 1000 });

      return { rang: true, wave, driverCount: created.length };
    }

    /*
     * Every radius, nobody. On a SCHEDULED booking this needs a human immediately — there is
     * still time to solve it by phone, which is the whole advantage of booking ahead.
     */
    await this.bookings.markNoDriverFound(
      bookingId,
      `No available driver after ${maxWaves} waves`,
    );

    logger[current.isScheduled ? 'error' : 'warn'](
      { bookingId, reference: current.reference, isScheduled: current.isScheduled },
      current.isScheduled
        ? 'SCHEDULED booking found no driver — escalate to ops now, there is still time'
        : 'booking found no driver',
    );

    return { rang: false, reason: 'GAVE_UP' };
  }
}

/**
 * A wave's TTL expired.
 *
 * Marks the wave lapsed and moves on. It does NOT give up on its own — that decision belongs to
 * the wave loop, which knows how many radii are left.
 */
export class ExpireWaveUseCase {
  constructor(
    private readonly offers: OfferRepositoryPort,
    private readonly bookings: BookingDispatchContract,
    private readonly runWave: RunDispatchWaveUseCase,
  ) {}

  async execute(bookingId: string, wave: number): Promise<void> {
    const booking = await this.bookings.findById(bookingId);
    if (booking === null || booking.status !== 'SEARCHING') return;

    const lapsed = await this.offers.lapseWave(bookingId, wave, new Date());

    /*
     * An offer that lapsed having never been delivered is OUR failure, not the driver's, and is
     * logged as such — the metrics job reads `deliveredVia` to decide whose acceptance rate this
     * touches.
     */
    const undelivered = lapsed.filter((offer) => offer.deliveredVia === 'NONE').length;
    if (undelivered > 0) {
      logger.warn(
        { bookingId, wave, undelivered, of: lapsed.length },
        'offers lapsed that were never delivered — infrastructure failure, not driver behaviour',
      );
    }

    await this.runWave.execute(bookingId, wave + 1);
  }
}
