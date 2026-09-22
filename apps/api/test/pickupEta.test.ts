import { describe, expect, it } from 'vitest';
import type { BookingStatus } from '@driverzone/contracts';
import { estimatePickupEtaMinutes } from '../src/modules/bookings/domain/pickupEta.js';

/**
 * The pickup estimate — the number a waiting customer is shown, and the many cases where they are
 * shown nothing instead.
 *
 * MOST OF THIS FILE IS ABOUT THE NULLS. The arithmetic is four lines and hard to get wrong; what
 * is easy to get wrong is showing a confident figure derived from a position recorded twenty
 * minutes ago in another city, which is precisely the failure an ETA makes plausible. So every
 * gate gets a test, and the two boundaries that decide a customer sees a number at all — the fix
 * age and the plausible distance — get one on each side.
 */

const PICKUP = { lat: 22.5726, lng: 88.3639 };
const NOW = new Date('2026-09-22T12:00:00+05:30');

/**
 * Metres due north of the pickup, EXACTLY as `distanceMetres` measures it.
 *
 * Along a meridian the haversine collapses to `R × Δlat`, so inverting it with the same earth
 * radius the implementation uses gives a point the implementation agrees is precisely this far
 * away. A rounder 111_320 m/degree is off by ~100 m at 60 km — which is nothing on a map and
 * everything to the boundary tests below, where being on the wrong side of the line is the
 * entire assertion.
 */
const EARTH_RADIUS_M = 6_371_000;

function northOf(metres: number): { lat: number; lng: number } {
  return { lat: PICKUP.lat + (metres / EARTH_RADIUS_M) * (180 / Math.PI), lng: PICKUP.lng };
}

function eta(over: {
  status?: BookingStatus;
  driverAt?: { lat: number; lng: number } | null;
  fixAgeMs?: number;
}): number | null {
  const fixAgeMs = over.fixAgeMs ?? 10_000;
  const driverAt = over.driverAt === undefined ? northOf(3000) : over.driverAt;

  return estimatePickupEtaMinutes({
    status: over.status ?? 'DRIVER_EN_ROUTE',
    pickup: PICKUP,
    driverAt,
    driverFixAt: driverAt === null ? null : new Date(NOW.getTime() - fixAgeMs),
    now: NOW,
  });
}

describe('estimatePickupEtaMinutes', () => {
  it('answers while the driver is on the way', () => {
    // 3 km straight line → 3.9 km of road at 22 km/h ≈ 10.6 min, ceiling 11.
    expect(eta({})).toBe(11);
  });

  it('answers the moment a driver is assigned, before they set off', () => {
    expect(eta({ status: 'ASSIGNED' })).toBe(11);
  });

  it('grows with the distance', () => {
    const near = eta({ driverAt: northOf(1000) });
    const far = eta({ driverAt: northOf(8000) });
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(far!).toBeGreaterThan(near!);
  });

  /*
   * A driver practically on top of the pickup still has to stop, park and be found. Zero would
   * read as a fact that is about to be falsified — see the function's own note.
   */
  it('never returns zero, however close the driver is', () => {
    expect(eta({ driverAt: northOf(5) })).toBe(1);
  });

  describe('says nothing rather than guessing', () => {
    it('when no driver is assigned', () => {
      expect(eta({ status: 'SEARCHING', driverAt: null })).toBeNull();
    });

    /*
     * THE CASE MOST WORTH HOLDING. "~1 min" beside "Driver has arrived" is the screen
     * contradicting itself, and the driver being there is what answers the question.
     */
    it('once the driver has arrived', () => {
      expect(eta({ status: 'ARRIVED' })).toBeNull();
    });

    it('once the trip is under way or over', () => {
      expect(eta({ status: 'STARTED' })).toBeNull();
      expect(eta({ status: 'COMPLETED' })).toBeNull();
      expect(eta({ status: 'CANCELLED_BY_CUSTOMER' })).toBeNull();
    });

    it('when the driver has never reported a position', () => {
      expect(eta({ driverAt: null })).toBeNull();
    });

    it('when the last fix is too old to be evidence of anything', () => {
      // Drivers flush every 15s, so three minutes of silence is something genuinely wrong.
      expect(eta({ fixAgeMs: 3 * 60_000 + 1 })).toBeNull();
      expect(eta({ fixAgeMs: 3 * 60_000 - 1 })).not.toBeNull();
    });

    /* A handset whose clock is ahead is not reporting the future; it is reporting nothing. */
    it('when the fix is dated in the future, which is a skewed clock', () => {
      expect(eta({ fixAgeMs: -60_000 })).toBeNull();
    });

    /*
     * 200 km away is a stale position from another city or a transposed coordinate pair, not
     * somebody who is coming. "6 hours" would be arithmetically right and useless.
     */
    it('when the driver is implausibly far away', () => {
      expect(eta({ driverAt: northOf(60_001) })).toBeNull();
      expect(eta({ driverAt: northOf(59_000) })).not.toBeNull();
    });
  });
});
