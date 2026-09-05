import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COUNTS_AGAINST_ACCEPTANCE,
  radiusForWave,
  rankCandidates,
  scoreCandidate,
  type DispatchOffer,
  type DriverCandidate,
  type OfferStatus,
} from '../src/modules/dispatch/domain/offer.entity.js';
import type {
  DriverPoolPort,
  NewOffer,
  OfferRepositoryPort,
} from '../src/modules/dispatch/domain/ports.js';
import { RunDispatchWaveUseCase } from '../src/modules/dispatch/application/useCases/runWave.usecase.js';
import { AcceptOfferUseCase } from '../src/modules/dispatch/application/useCases/respondToOffer.usecase.js';
import type {
  Booking,
  BookingDispatchContract,
  ClaimResult,
} from '../src/modules/bookings/bookings.public.js';
import type { NotificationsContract } from '../src/modules/notifications/notifications.public.js';
import type { SettingsReadContract } from '../src/modules/settings/settings.public.js';
import { buildSnapshot } from '../src/modules/settings/domain/setting.entity.js';
import { jobIdFor } from '../src/shared/queue/dispatchJobs.js';

const settings: SettingsReadContract = {
  snapshot: async () => buildSnapshot([]),
  get: async (key) => buildSnapshot([])[key],
};

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'bkg_1',
    reference: 'DZ-8F3K2M',
    customerId: 'cus_1',
    driverId: null,
    status: 'SEARCHING',
    serviceType: 'INCITY',
    pickup: { lat: 26.7271, lng: 88.3953 },
    pickupAddress: 'Hill Cart Road',
    drop: { lat: 26.73, lng: 88.4 },
    dropAddress: 'Sevoke Road',
    direction: null,
    distanceKm: null,
    quoteId: 'qot_1',
    paymentId: 'pay_1',
    isScheduled: false,
    scheduledAt: new Date(),
    dispatchAt: new Date(),
    assignedAt: null,
    enRouteAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    waitingMinutes: null,
    waitingChargePaise: null,
    driverLateMinutes: null,
    otpAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    fareSnapshot: {
      version: 1,
      serviceType: 'INCITY',
      computedAt: new Date(),
      source: {
        packageId: 'pkg_1',
        packageName: 'Siliguri Hourly',
        variantId: 'var_1',
        variantLabel: '3 Hours',
        pickupZoneId: 'zon_1',
        pickupZoneName: 'Siliguri Central',
        cityZoneId: 'zon_city',
        cityName: 'Siliguri',
        terrain: null,
      },
      included: { minutes: 180 },
      fare: {
        serviceType: 'INCITY',
        lines: [{ code: 'BASE', label: '3 Hours', amountPaise: 90_000 }],
        subtotalPaise: 103_000,
        taxBps: 500,
        taxPaise: 5_200,
        totalPaise: 108_200,
        split: {
          commissionablePaise: 103_000,
          driverCommissionBps: 7_500,
          driverPaise: 77_250,
          companyPaise: 25_750,
        },
      },
    },
    ...over,
  };
}

function fakeOffers() {
  const rows = new Map<string, DispatchOffer>();
  let next = 0;

  const repo: OfferRepositoryPort & { all: () => DispatchOffer[] } = {
    all: () => [...rows.values()],

    createMany: vi.fn(async (offers: readonly NewOffer[]) =>
      offers.map((offer) => {
        const row: DispatchOffer = {
          id: `ofr_${(next += 1)}`,
          ...offer,
          status: 'SENT',
          deliveredVia: 'NONE',
          deliveredAt: null,
          respondedAt: null,
          createdAt: new Date(),
        };
        rows.set(row.id, row);
        return row;
      }),
    ),

    findById: vi.fn(async (id: string) => rows.get(id) ?? null),
    findAllLiveForDriver: vi.fn(async (driverId: string) =>
      [...rows.values()]
        .filter((r) => r.driverId === driverId && r.status === 'SENT' && r.expiresAt > new Date())
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()),
    ),
    listForBooking: vi.fn(async () => [...rows.values()]),
    driverIdsOffered: vi.fn(async () => [...rows.values()].map((r) => r.driverId)),

    respond: vi.fn(async (id: string, to: OfferStatus, now: Date) => {
      const row = rows.get(id);
      if (row === undefined || row.status !== 'SENT' || row.expiresAt <= now) return null;
      const updated = { ...row, status: to, respondedAt: now };
      rows.set(id, updated);
      return updated;
    }),

    supersedeOthers: vi.fn(async (bookingId: string, except: string) => {
      const live = [...rows.values()].filter(
        (r) => r.bookingId === bookingId && r.id !== except && r.status === 'SENT',
      );
      for (const row of live) rows.set(row.id, { ...row, status: 'SUPERSEDED' });
      return live;
    }),

    releaseAccepted: vi.fn(async (id: string) => {
      const row = rows.get(id);
      if (row === undefined || row.status !== 'ACCEPTED') return null;
      const updated = { ...row, status: 'SUPERSEDED' as const };
      rows.set(id, updated);
      return updated;
    }),

    lapseWave: vi.fn(async (bookingId: string, wave: number) => {
      const live = [...rows.values()].filter(
        (r) => r.bookingId === bookingId && r.wave === wave && r.status === 'SENT',
      );
      for (const row of live) rows.set(row.id, { ...row, status: 'LAPSED' });
      return live;
    }),

    recordDelivery: vi.fn(async (id: string, via) => {
      const row = rows.get(id);
      if (row !== undefined) rows.set(id, { ...row, deliveredVia: via, deliveredAt: new Date() });
    }),
  };

  return repo;
}

function fakePool(candidatesByRadius: Record<number, DriverCandidate[]>): DriverPoolPort {
  return {
    findEligible: vi.fn(async (query) => {
      const found = candidatesByRadius[query.radiusMetres] ?? [];
      return found.filter((c) => !query.excludeDriverIds.includes(c.driverId));
    }),
  };
}

function fakeBookings(seed: Booking, claim: ClaimResult | null = null) {
  let current = seed;
  const contract: BookingDispatchContract & { current: () => Booking } = {
    current: () => current,
    findById: vi.fn(async () => current),
    beginSearching: vi.fn(async () => {
      current = { ...current, status: 'SEARCHING' };
      return current;
    }),
    /*
     * Models the real CAS: `driverId: null` AND `status: SEARCHING` are both conditions, so the
     * second caller loses. A fake that always succeeded would make the five-way race test below
     * assert nothing at all.
     */
    claimForDriver: vi.fn(async (_bookingId: string, driverId: string) => {
      if (claim !== null) return claim;
      if (current.driverId !== null || current.status !== 'SEARCHING') {
        return { claimed: false as const, reason: 'ALREADY_ASSIGNED' as const };
      }
      current = { ...current, status: 'ASSIGNED', driverId };
      return { claimed: true as const, booking: current };
    }),
    markNoDriverFound: vi.fn(async () => {
      current = { ...current, status: 'NO_DRIVER_FOUND' };
      return current;
    }),
    findDueForDispatch: vi.fn(async () => []),
  };
  return contract;
}

function fakeNotifications(): NotificationsContract {
  return {
    sendOffer: vi.fn(async () => 'BOTH' as const),
    cancelOffer: vi.fn(async () => undefined),
    sendBookingUpdate: vi.fn(async () => undefined),
  };
}

const candidate = (id: string, over: Partial<DriverCandidate> = {}): DriverCandidate => ({
  driverId: id,
  distanceMetres: 1_000,
  acceptanceRate: 0.8,
  rating: 4.5,
  idleMinutes: 20,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('radiusForWave', () => {
  it('doubles each wave from the configured base', () => {
    expect(radiusForWave(1, 3_000)).toBe(3_000);
    expect(radiusForWave(2, 3_000)).toBe(6_000);
    expect(radiusForWave(3, 3_000)).toBe(12_000);
    expect(radiusForWave(4, 3_000)).toBe(24_000);
  });
});

describe('scoring', () => {
  it('prefers the nearer of two otherwise identical drivers', () => {
    const near = scoreCandidate(candidate('a', { distanceMetres: 200 }), 3_000);
    const far = scoreCandidate(candidate('b', { distanceMetres: 2_800 }), 3_000);
    expect(near).toBeGreaterThan(far);
  });

  it('treats a brand-new driver as average, not as worst', () => {
    // Scoring an unrated driver at zero would mean they never get a trip, and so never acquire
    // the history that would fix it.
    const unrated = scoreCandidate(candidate('new', { acceptanceRate: null, rating: null }), 3_000);
    const poor = scoreCandidate(candidate('poor', { acceptanceRate: 0, rating: 1 }), 3_000);
    expect(unrated).toBeGreaterThan(poor);
  });

  it('ranks highest first, breaking ties by distance', () => {
    const ranked = rankCandidates(
      [
        candidate('far', { distanceMetres: 2_500 }),
        candidate('near', { distanceMetres: 300 }),
        candidate('mid', { distanceMetres: 1_200 }),
      ],
      3_000,
    );
    expect(ranked.map((r) => r.driverId)).toEqual(['near', 'mid', 'far']);
  });

  it('never counts a superseded offer against a driver', () => {
    expect(COUNTS_AGAINST_ACCEPTANCE).not.toContain('SUPERSEDED');
    expect(COUNTS_AGAINST_ACCEPTANCE).toContain('DECLINED');
    expect(COUNTS_AGAINST_ACCEPTANCE).toContain('LAPSED');
  });
});

describe('RunDispatchWaveUseCase', () => {
  let offers: ReturnType<typeof fakeOffers>;
  let scheduled: Array<{ bookingId: string; wave: number; delayMs: number }>;

  beforeEach(() => {
    offers = fakeOffers();
    scheduled = [];
  });

  function build(pool: DriverPoolPort, bookings = fakeBookings(booking())) {
    return {
      bookings,
      useCase: new RunDispatchWaveUseCase(
        offers,
        pool,
        bookings,
        settings,
        fakeNotifications(),
        async (input) => {
          scheduled.push(input);
        },
      ),
    };
  }

  it('rings the top five drivers of the first wave', async () => {
    const pool = fakePool({
      3_000: Array.from({ length: 8 }, (_, i) => candidate(`drv_${i}`, { distanceMetres: i * 100 })),
    });

    const { useCase } = build(pool);
    const outcome = await useCase.execute('bkg_1');

    expect(outcome).toEqual({ rang: true, wave: 1, driverCount: 5 });
    expect(offers.all()).toHaveLength(5);
    // Nearest first — the ranking actually decided who was rung.
    expect(offers.all()[0]?.driverId).toBe('drv_0');
  });

  it('schedules the wave timeout on the queue, never as a timer', async () => {
    const { useCase } = build(fakePool({ 3_000: [candidate('drv_1')] }));
    await useCase.execute('bkg_1');

    expect(scheduled).toEqual([{ bookingId: 'bkg_1', wave: 1, delayMs: 45_000 }]);
  });

  it('widens immediately when a wave finds nobody, rather than burning its TTL', async () => {
    const pool = fakePool({ 3_000: [], 6_000: [], 12_000: [candidate('drv_far')] });

    const { useCase } = build(pool);
    const outcome = await useCase.execute('bkg_1');

    expect(outcome).toEqual({ rang: true, wave: 3, driverCount: 1 });
    // One timeout, for the wave that actually rang someone.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.wave).toBe(3);
  });

  it('gives up after the last wave and marks the booking NO_DRIVER_FOUND', async () => {
    const { bookings, useCase } = build(fakePool({}));
    const outcome = await useCase.execute('bkg_1');

    expect(outcome).toEqual({ rang: false, reason: 'GAVE_UP' });
    expect(bookings.markNoDriverFound).toHaveBeenCalled();
    expect(bookings.current().status).toBe('NO_DRIVER_FOUND');
  });

  it('moves a CONFIRMED booking into SEARCHING before ringing anyone', async () => {
    const bookings = fakeBookings(booking({ status: 'CONFIRMED' }));
    const { useCase } = build(fakePool({ 3_000: [candidate('drv_1')] }), bookings);

    await useCase.execute('bkg_1');
    expect(bookings.beginSearching).toHaveBeenCalled();
  });

  it('does nothing for a booking that is no longer searching', async () => {
    const bookings = fakeBookings(booking({ status: 'ASSIGNED', driverId: 'drv_9' }));
    const { useCase } = build(fakePool({ 3_000: [candidate('drv_1')] }), bookings);

    const outcome = await useCase.execute('bkg_1');
    expect(outcome).toEqual({ rang: false, reason: 'NOT_SEARCHING' });
    expect(offers.all()).toHaveLength(0);
  });

  it('requires a hill-VERIFIED driver for a hill destination', async () => {
    const pool = fakePool({ 3_000: [candidate('drv_1')] });
    const hillBooking = booking();
    hillBooking.fareSnapshot.source.terrain = 'HILL';

    const { useCase } = build(pool, fakeBookings(hillBooking));
    await useCase.execute('bkg_1');

    expect(pool.findEligible).toHaveBeenCalledWith(
      expect.objectContaining({ requireHillVerified: true }),
    );
  });

  it('does not ring a driver twice across waves', async () => {
    const pool = fakePool({
      3_000: [candidate('drv_1')],
      6_000: [candidate('drv_1'), candidate('drv_2')],
    });

    const { useCase } = build(pool);
    await useCase.execute('bkg_1');
    await useCase.execute('bkg_1', 2);

    const rung = offers.all().map((o) => o.driverId);
    expect(rung).toEqual(['drv_1', 'drv_2']);
  });
});

describe('AcceptOfferUseCase — the race', () => {
  let offers: ReturnType<typeof fakeOffers>;

  beforeEach(() => {
    offers = fakeOffers();
  });

  async function ringFive() {
    return offers.createMany(
      Array.from({ length: 5 }, (_, i) => ({
        bookingId: 'bkg_1',
        driverId: `drv_${i}`,
        wave: 1,
        score: 0.5,
        distanceMetres: 500,
        expiresAt: new Date(Date.now() + 45_000),
      })),
    );
  }

  it('lets exactly one of five simultaneous accepts win', async () => {
    const created = await ringFive();
    const bookings = fakeBookings(booking());
    const notifications = fakeNotifications();
    const useCase = new AcceptOfferUseCase(offers, bookings, notifications);

    const results = await Promise.all(
      created.map((offer) => useCase.execute(offer.id, offer.driverId)),
    );

    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(results.filter((r) => !r.claimed)).toHaveLength(4);
  });

  it('withdraws the losers’ ringing offers so nobody stares at a dead screen', async () => {
    const created = await ringFive();
    const notifications = fakeNotifications();
    const useCase = new AcceptOfferUseCase(offers, fakeBookings(booking()), notifications);

    await useCase.execute(created[0]!.id, 'drv_0');

    expect(notifications.cancelOffer).toHaveBeenCalledTimes(4);
    expect(offers.all().filter((o) => o.status === 'SUPERSEDED')).toHaveLength(4);
  });

  it('marks a driver who lost as SUPERSEDED, never DECLINED or LAPSED', async () => {
    // The whole point: losing a race must not touch their acceptance rate.
    const created = await ringFive();
    const useCase = new AcceptOfferUseCase(offers, fakeBookings(booking()), fakeNotifications());

    await useCase.execute(created[0]!.id, 'drv_0');

    for (const offer of offers.all().filter((o) => o.driverId !== 'drv_0')) {
      expect(offer.status).toBe('SUPERSEDED');
      expect(COUNTS_AGAINST_ACCEPTANCE).not.toContain(offer.status);
    }
  });

  it('rolls the offer back when the booking cannot be claimed', async () => {
    const created = await ringFive();
    const bookings = fakeBookings(booking(), { claimed: false, reason: 'ALREADY_ASSIGNED' });
    const useCase = new AcceptOfferUseCase(offers, bookings, fakeNotifications());

    const result = await useCase.execute(created[0]!.id, 'drv_0');

    expect(result).toMatchObject({ claimed: false, reason: 'ALREADY_ASSIGNED' });
    // Accepted in good faith and lost to something outside their control — not their fault.
    expect(offers.all().find((o) => o.id === created[0]!.id)?.status).toBe('SUPERSEDED');
  });

  it('refuses an expired offer', async () => {
    const [offer] = await offers.createMany([
      {
        bookingId: 'bkg_1',
        driverId: 'drv_1',
        wave: 1,
        score: 0.5,
        distanceMetres: 500,
        expiresAt: new Date(Date.now() - 1_000),
      },
    ]);

    const useCase = new AcceptOfferUseCase(offers, fakeBookings(booking()), fakeNotifications());
    const result = await useCase.execute(offer!.id, 'drv_1');

    expect(result).toMatchObject({ claimed: false, reason: 'OFFER_EXPIRED' });
  });

  it("refuses to let a driver accept somebody else's offer", async () => {
    const created = await ringFive();
    const useCase = new AcceptOfferUseCase(offers, fakeBookings(booking()), fakeNotifications());

    await expect(useCase.execute(created[0]!.id, 'drv_impostor')).rejects.toMatchObject({
      code: 'OFFER_NOT_FOUND',
    });
  });
});

/**
 * The regression test for the actual bug this feature fixes: two customers booking
 * near-simultaneously can legitimately ring the SAME driver for two DIFFERENT bookings at once.
 * `findLiveForDriver` used to be a `findOne` — arbitrary the moment a second row existed, and the
 * root cause of the ring screen showing one offer while acting on another's id.
 */
describe('findAllLiveForDriver — a driver with more than one live offer', () => {
  it('returns every SENT, unexpired offer for that driver, soonest-expiring first', async () => {
    const offers = fakeOffers();
    const soon = new Date(Date.now() + 10_000);
    const later = new Date(Date.now() + 40_000);

    // Created in the OPPOSITE order to the expiry order, so a passing test cannot be an accident
    // of insertion order rather than an actual sort.
    const [a] = await offers.createMany([
      { bookingId: 'bkg_later', driverId: 'drv_1', wave: 1, score: 0.5, distanceMetres: 500, expiresAt: later },
    ]);
    const [b] = await offers.createMany([
      { bookingId: 'bkg_soon', driverId: 'drv_1', wave: 1, score: 0.5, distanceMetres: 300, expiresAt: soon },
    ]);

    const live = await offers.findAllLiveForDriver('drv_1');

    expect(live.map((o) => o.id)).toEqual([b!.id, a!.id]);
    expect(live.map((o) => o.bookingId)).toEqual(['bkg_soon', 'bkg_later']);
  });

  it('excludes another driver’s offers, and this driver’s own expired or already-answered ones', async () => {
    const offers = fakeOffers();
    const now = Date.now();

    const [live] = await offers.createMany([
      { bookingId: 'bkg_1', driverId: 'drv_1', wave: 1, score: 0.5, distanceMetres: 500, expiresAt: new Date(now + 30_000) },
    ]);
    await offers.createMany([
      { bookingId: 'bkg_2', driverId: 'drv_1', wave: 1, score: 0.5, distanceMetres: 500, expiresAt: new Date(now - 1_000) }, // expired
      { bookingId: 'bkg_3', driverId: 'drv_2', wave: 1, score: 0.5, distanceMetres: 500, expiresAt: new Date(now + 30_000) }, // another driver
    ]);
    const [declined] = await offers.createMany([
      { bookingId: 'bkg_4', driverId: 'drv_1', wave: 1, score: 0.5, distanceMetres: 500, expiresAt: new Date(now + 30_000) },
    ]);
    await offers.respond(declined!.id, 'DECLINED', new Date());

    const result = await offers.findAllLiveForDriver('drv_1');

    expect(result.map((o) => o.id)).toEqual([live!.id]);
  });

  it('accepting one offer never touches a different, still-live offer for the same driver', async () => {
    // The two-booking case this whole feature is for: accepting booking A must not silently
    // withdraw or supersede a simultaneously-ringing offer for booking B.
    const offers = fakeOffers();
    const now = Date.now();

    const [offerA] = await offers.createMany([
      { bookingId: 'bkg_a', driverId: 'drv_1', wave: 1, score: 0.5, distanceMetres: 500, expiresAt: new Date(now + 30_000) },
    ]);
    const [offerB] = await offers.createMany([
      { bookingId: 'bkg_b', driverId: 'drv_1', wave: 1, score: 0.5, distanceMetres: 500, expiresAt: new Date(now + 30_000) },
    ]);

    const useCase = new AcceptOfferUseCase(offers, fakeBookings(booking({ id: 'bkg_a' })), fakeNotifications());
    const result = await useCase.execute(offerA!.id, 'drv_1');

    expect(result.claimed).toBe(true);
    expect(offers.all().find((o) => o.id === offerB!.id)?.status).toBe('SENT');
    expect(await offers.findAllLiveForDriver('drv_1')).toEqual([
      offers.all().find((o) => o.id === offerB!.id),
    ]);
  });
});

describe('queue job ids', () => {
  it('never contains a colon', () => {
    // BullMQ refuses a custom job id containing ':' — it namespaces its own Redis keys with them
    // and throws "Custom Id cannot contain :" at add() time. The colon-separated form in
    // docs/LLD/dispatch-and-assignment.md cannot work, and this is what stops it coming back.
    expect(jobIdFor('dispatch', 'bkg_1')).toBe('dispatch-bkg_1');
    expect(jobIdFor('wave', 'bkg_1', 3)).toBe('wave-bkg_1-3');
    expect(jobIdFor('dispatch', 'bkg_1')).not.toContain(':');
    expect(jobIdFor('wave', 'bkg_1', 3)).not.toContain(':');
  });

  it('is deterministic, so re-enqueueing the same work is a no-op', () => {
    // What makes the sweeper's re-enqueue safe: a booking whose original job is merely running
    // late gets the same id back, not a second dispatch that rings every driver twice.
    expect(jobIdFor('dispatch', 'bkg_1')).toBe(jobIdFor('dispatch', 'bkg_1'));
    expect(jobIdFor('wave', 'bkg_1', 2)).not.toBe(jobIdFor('wave', 'bkg_1', 3));
  });
});
