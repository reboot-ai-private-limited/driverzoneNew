import { logger } from '../../../../shared/logging/logger.js';
import { rupeesToPaise, type SettingsReadContract } from '../../../settings/settings.public.js';
import type { Booking, BookingDispatchContract } from '../../../bookings/bookings.public.js';
import type { FavouriteDriversContract } from '../../../favourites/favourites.public.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import type { DriverCandidate } from '../../domain/offer.entity.js';
import { attemptFor, radiusForWave, rankCandidates } from '../../domain/offer.entity.js';
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
 * WAVE 0 — the customer's own drivers, rung before the radius ladder starts.
 *
 * NUMBERED ZERO RATHER THAN SHIFTING EVERY OTHER WAVE UP, which is what makes it almost free: the
 * offer rows, the BullMQ timeout job, the `driverIdsOffered` exclusion that stops a favourite who
 * ignored it being rung again, and `ExpireWaveUseCase`'s `wave + 1` all work unchanged, and
 * `wave + 1` from here lands exactly on the ordinary first wave.
 */
const FAVOURITE_WAVE = 0;

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
 * spends the time. The favourite wave follows the same rule: a customer whose favourites are all
 * off duty waits no longer than one who named none.
 */
export class RunDispatchWaveUseCase {
  constructor(
    private readonly offers: OfferRepositoryPort,
    private readonly pool: DriverPoolPort,
    private readonly bookings: BookingDispatchContract,
    private readonly settings: SettingsReadContract,
    private readonly notifications: NotificationsContract,
    private readonly scheduleTimeout: WaveTimeoutScheduler,
    /** Read live, not frozen onto the booking — see `Booking.preferFavouriteDrivers`. */
    private readonly favourites: FavouriteDriversContract,
  ) {}

  /**
   * `startWave` defaults to the FAVOURITE wave, so the dispatch job, the sweeper and an admin
   * retry all enter at the same door. Anything above 0 skips favourites entirely, which is what a
   * wave timeout wants: that wave has already been rung and answered.
   */
  async execute(bookingId: string, startWave = FAVOURITE_WAVE): Promise<WaveOutcome> {
    const booking = await this.bookings.findById(bookingId);
    if (booking === null) return { rang: false, reason: 'NOT_FOUND' };

    /*
     * AN ADMIN IS ASSIGNING THIS ONE BY HAND. The sweeper already skips it; this covers any job
     * that reaches here anyway — a stale enqueue, a retried job — so no driver is ever rung for a
     * booking ops booked from the panel. `POST /admin/bookings/:id/auto-dispatch` flips the mode
     * first when ops does want it rung.
     */
    if (booking.dispatchMode === 'MANUAL') {
      logger.info({ bookingId }, 'manual-dispatch booking reached a wave — not ringing anybody');
      return { rang: false, reason: 'NOT_SEARCHING' };
    }

    /*
     * The first wave is what moves a booking out of a waiting state. Later waves find it already
     * in `SEARCHING`.
     *
     * TWO DOORS, not one. `CONFIRMED` is a booking nothing has looked for yet — the early ring of
     * a scheduled booking, and every ring of an immediate one. `WAITING_DRIVER` is the final ring
     * at T−90 picking up a booking whose early search found nobody. Both are driverless and both
     * start the same way.
     */
    if (booking.status === 'CONFIRMED' || booking.status === 'WAITING_DRIVER') {
      await this.bookings.beginSearching(bookingId, booking.status);
    }

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
    const maxNegativeBalancePaise = rupeesToPaise(snapshot['driver.max_negative_balance']);

    /*
     * WHICH SEARCH THIS IS, derived from the booking rather than carried in the job.
     *
     * A wave timeout enqueued by the early ring fires minutes later and re-enters here; deriving
     * the attempt from `dispatchAt` means that resumed job reaches the same answer as the ring
     * that scheduled it, with no payload to migrate and nothing that can drift after a deploy.
     */
    const attempt = attemptFor(current);

    /*
     * Scoped to this attempt. The early ring's offers must NOT exclude those drivers from the
     * final ring hours later — see `driverIdsOffered`.
     */
    const alreadyOffered = await this.offers.driverIdsOffered(bookingId, attempt);

    if (startWave <= FAVOURITE_WAVE) {
      const rang = await this.ringFavourites(current, {
        alreadyOffered,
        maxNegativeBalancePaise,
        radiusMetres: snapshot['dispatch.favourite_radius_m'],
        ttlSeconds: snapshot['dispatch.favourite_offer_ttl_seconds'],
      });

      if (rang !== null) return rang;
    }

    for (let wave = Math.max(1, startWave); wave <= maxWaves; wave += 1) {
      const radiusMetres = radiusForWave(wave, snapshot['dispatch.wave_base_radius_m']);

      const candidates = await this.pool.findEligible({
        pickup: current.pickup,
        radiusMetres,
        requireHillVerified: current.fareSnapshot.source.terrain === 'HILL',
        carCategory: current.carCategory,
        vehicleType: current.vehicleType,
        excludeDriverIds: alreadyOffered,
        maxNegativeBalancePaise,
        now: new Date(),
      });

      if (candidates.length === 0) {
        logger.info({ bookingId, wave, radiusMetres }, 'no eligible drivers — widening immediately');
        continue;
      }

      const chosen = rankCandidates(candidates, radiusMetres).slice(0, waveSize);

      return this.ring(current, wave, chosen, ttlSeconds);
    }

    /*
     * EVERY RADIUS, NOBODY — and what that means depends on which search just ran out.
     *
     * On the EARLY ring it means "not yet". The booking is parked in `WAITING_DRIVER`: ops can see
     * it, an eligible driver can take it off the scheduled board, and the final ring will ask
     * again at T−90. Nothing is lost and the customer is told we are still looking.
     *
     * On the FINAL ring it means "no". There is no later search to wait for, so the booking is
     * given up exactly as it always was.
     */
    const reason = `No available driver after ${maxWaves} waves`;

    if (attempt === 'EARLY') {
      await this.bookings.markWaitingForDriver(bookingId, reason);

      logger.info(
        { bookingId, reference: current.reference, dispatchAt: current.dispatchAt },
        'early ring found no driver — parked as WAITING_DRIVER, will ring again at T−90',
      );

      /*
       * TELL THE CUSTOMER, because silence here is what the parked state exists to replace.
       *
       * They booked a trip and nothing visible happened; without this the app quietly changes a
       * line of text they are not looking at. The message says the trip is still on and that we
       * will try again — it does NOT apologise, because nothing has gone wrong yet, and it does
       * not promise a driver, because we do not have one.
       *
       * Tolerant of failure like every other notification in this file: a customer who missed the
       * push still sees the state when they open the app, and a dead token must not turn a
       * correctly parked booking into a failed dispatch job that gets retried.
       */
      try {
        await this.notifications.sendBookingUpdate(
          { role: 'CUSTOMER', id: current.customerId },
          {
            bookingId,
            reference: current.reference,
            status: 'WAITING_DRIVER',
            message:
              "No one has taken your trip yet. We'll keep looking and try again closer to your pickup time.",
          },
        );
      } catch (error) {
        logger.warn({ err: error, bookingId }, 'could not tell the customer their trip is parked');
      }

      return { rang: false, reason: 'GAVE_UP' };
    }

    await this.bookings.markNoDriverFound(bookingId, reason);

    logger[current.isScheduled ? 'error' : 'warn'](
      { bookingId, reference: current.reference, isScheduled: current.isScheduled },
      current.isScheduled
        ? 'SCHEDULED booking found no driver on the final ring — nothing left to try'
        : 'booking found no driver',
    );

    return { rang: false, reason: 'GAVE_UP' };
  }

  /**
   * Wave 0, or `null` meaning "nothing rung, carry on with the ordinary search".
   *
   * NULL RATHER THAN A `WaveOutcome` for the skip cases, because none of them is an outcome the
   * booking has reached — the search has not failed, it has simply not started. Every one of them
   * falls straight through to the radius ladder with no delay:
   *
   *   - the customer did not ask for favourites on this booking;
   *   - they asked but have none;
   *   - they have some, and not one of them is eligible and in range right now.
   *
   * The whole list is offered, NOT `wave_size` of it. The cap on favourites (`MAX_FAVOURITES`) is
   * what bounds this, and truncating a customer's own chosen drivers by a ranking they cannot see
   * would be the one place in dispatch where the score decides something a person already decided.
   */
  private async ringFavourites(
    booking: Booking,
    context: {
      alreadyOffered: readonly string[];
      maxNegativeBalancePaise: number;
      radiusMetres: number;
      ttlSeconds: number;
    },
  ): Promise<WaveOutcome | null> {
    if (!booking.preferFavouriteDrivers) return null;

    const favouriteIds = await this.favourites.favouriteDriverIds(booking.customerId);
    if (favouriteIds.length === 0) return null;

    const candidates = await this.pool.findEligible({
      pickup: booking.pickup,
      radiusMetres: context.radiusMetres,
      requireHillVerified: booking.fareSnapshot.source.terrain === 'HILL',
      carCategory: booking.carCategory,
      vehicleType: booking.vehicleType,
      excludeDriverIds: context.alreadyOffered,
      restrictToDriverIds: favouriteIds,
      maxNegativeBalancePaise: context.maxNegativeBalancePaise,
      now: new Date(),
    });

    if (candidates.length === 0) {
      logger.info(
        { bookingId: booking.id, favourites: favouriteIds.length },
        'no favourite driver is available — going straight to the ordinary search',
      );
      return null;
    }

    return this.ring(
      booking,
      FAVOURITE_WAVE,
      rankCandidates(candidates, context.radiusMetres),
      context.ttlSeconds,
    );
  }

  /**
   * Creates the offers, rings them, and starts the clock. Shared by wave 0 and every radius wave
   * so the two cannot drift — the favourite wave differs only in WHO is in `chosen` and for how
   * long, never in what happens to them.
   */
  private async ring(
    booking: Booking,
    wave: number,
    chosen: ReadonlyArray<DriverCandidate & { score: number }>,
    ttlSeconds: number,
  ): Promise<WaveOutcome> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const created = await this.offers.createMany(
      chosen.map(
        (candidate): NewOffer => ({
          bookingId: booking.id,
          driverId: candidate.driverId,
          wave,
          /*
           * Re-derived here rather than passed down from `execute`, so it stays correct for the
           * favourite wave too — that path reaches `ring` by its own route. Both callers are
           * within milliseconds of the same `dispatchAt` comparison, so the two always agree.
           */
          attempt: attemptFor(booking),
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
            bookingId: booking.id,
            reference: booking.reference,
            expiresAt,
            earningPaise: booking.fareSnapshot.fare.split.driverPaise,
            pickupAddress: booking.pickupAddress,
            dropAddress: booking.dropAddress,
            scheduledAt: booking.scheduledAt,
            serviceType: booking.serviceType,
          });
          await this.offers.recordDelivery(offer.id, via);
        } catch (error) {
          logger.warn({ err: error, offerId: offer.id }, 'could not deliver an offer');
          await this.offers.recordDelivery(offer.id, 'NONE');
        }
      }),
    );

    await this.scheduleTimeout({ bookingId: booking.id, wave, delayMs: ttlSeconds * 1000 });

    return { rang: true, wave, driverCount: created.length };
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

    /*
     * THE STALE-TIMEOUT GUARD. A wave whose drivers all declined has already been superseded by
     * the next one (`DeclineOfferUseCase`), but its BullMQ job is still in Redis and fires on
     * schedule regardless. Without this it would widen the search a second time, ringing a wave
     * nobody asked for — most visibly after the favourite wave, whose one driver saying no is the
     * common case.
     */
    if (await this.offers.hasOffersAfterWave(bookingId, wave)) return;

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
