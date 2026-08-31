import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKING_STATUSES, type BookingStatus } from '@driverzone/contracts';
import {
  canTransition,
  generateReference,
  isScheduledBooking,
  isTerminal,
  MAX_OTP_ATTEMPTS,
  TRANSITIONS,
  type Booking,
  type FareSnapshot,
} from '../src/modules/bookings/domain/booking.entity.js';
import { distanceMetres, isFixStale } from '../src/modules/bookings/domain/distance.js';
import type {
  BookingEvent,
  BookingRepositoryPort,
  NewBooking,
  TransitionPatch,
} from '../src/modules/bookings/domain/bookingRepository.port.js';
import type {
  CancellationCharge,
  ChargeRepositoryPort,
  FareAdjustment,
} from '../src/modules/bookings/domain/chargeRepository.port.js';
import { DriverArrivedUseCase } from '../src/modules/bookings/application/useCases/driverArrived.usecase.js';
import { StartTripUseCase } from '../src/modules/bookings/application/useCases/startTrip.usecase.js';
import { CompleteTripUseCase } from '../src/modules/bookings/application/useCases/completeTrip.usecase.js';
import { CancelBookingByCustomerUseCase } from '../src/modules/bookings/application/useCases/cancelBooking.usecase.js';
import { buildSnapshot } from '../src/modules/settings/domain/setting.entity.js';
import type { SettingsReadContract } from '../src/modules/settings/settings.public.js';
import type { LedgerWriteContract, NewLedgerEntry } from '../src/modules/ledger/ledger.public.js';
import type { NotificationsContract } from '../src/modules/notifications/notifications.public.js';
import type { PaymentsContract, Payment } from '../src/modules/payments/payments.public.js';

/** Straight from the wire enum, so the exhaustiveness check below cannot drift from it. */
const ALL_STATUSES: readonly BookingStatus[] = BOOKING_STATUSES;

const PICKUP = { lat: 26.7271, lng: 88.3953 };

const settings: SettingsReadContract = {
  snapshot: async () => buildSnapshot([]),
  get: async (key) => buildSnapshot([])[key],
};

function fareSnapshot(totalPaise = 105_000, driverPaise = 77_250): FareSnapshot {
  return {
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
      taxPaise: totalPaise - 103_000,
      totalPaise,
      split: {
        commissionablePaise: 103_000,
        driverCommissionBps: 7_500,
        driverPaise,
        companyPaise: 103_000 - driverPaise,
      },
    },
  };
}

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'bkg_1',
    reference: 'DZ-8F3K2M',
    customerId: 'cus_1',
    driverId: 'drv_1',
    status: 'DRIVER_EN_ROUTE',
    serviceType: 'INCITY',
    pickup: PICKUP,
    pickupAddress: 'Hill Cart Road',
    drop: { lat: 26.73, lng: 88.4 },
    dropAddress: 'Sevoke Road',
    direction: null,
    distanceKm: null,
    quoteId: 'qot_1',
    fareSnapshot: fareSnapshot(),
    paymentId: 'pay_1',
    isScheduled: false,
    scheduledAt: new Date('2026-08-31T09:00:00Z'),
    dispatchAt: new Date('2026-08-31T09:00:00Z'),
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
    createdAt: new Date('2026-08-31T08:00:00Z'),
    updatedAt: new Date('2026-08-31T08:00:00Z'),
    ...over,
  };
}

function fakeRepo(seed: Booking, otp = '4821') {
  let current = seed;
  const events: BookingEvent[] = [];

  const repo: BookingRepositoryPort & { current: () => Booking; events: () => BookingEvent[] } = {
    current: () => current,
    events: () => events,

    create: vi.fn(async (_data: NewBooking) => current),
    findById: vi.fn(async (id: string) => (id === current.id ? current : null)),
    findByQuoteId: vi.fn(async () => current),
    findByPaymentId: vi.fn(async () => current),
    listForCustomer: vi.fn(async () => [current]),
    readStartOtp: vi.fn(async () => otp),
    incrementOtpAttempts: vi.fn(async () => {
      current = { ...current, otpAttempts: current.otpAttempts + 1 };
      return current.otpAttempts;
    }),
    attachPayment: vi.fn(async () => undefined),

    transition: vi.fn(
      async (input: {
        bookingId: string;
        from: BookingStatus;
        to: BookingStatus;
        actor: { type: BookingEvent['actorType']; id: string | null };
        reason?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        patch?: TransitionPatch | undefined;
      }) => {
        if (current.status !== input.from) return null;
        current = { ...current, status: input.to, ...(input.patch ?? {}) };
        events.push({
          id: `evt_${events.length}`,
          bookingId: current.id,
          fromStatus: input.from,
          toStatus: input.to,
          actorType: input.actor.type,
          actorId: input.actor.id,
          reason: input.reason ?? null,
          metadata: input.metadata ?? {},
          createdAt: new Date(),
        });
        return current;
      },
    ),

    claimForDriver: vi.fn(async () => null),
    listEvents: vi.fn(async () => events),
    findDueForDispatch: vi.fn(async () => []),
    findAbandonedPayments: vi.fn(async () => []),
  };

  return repo;
}

function fakeCharges() {
  const adjustments: FareAdjustment[] = [];
  let cancellation: CancellationCharge | null = null;
  const pinReports: unknown[] = [];

  const charges: ChargeRepositoryPort & {
    adjustments: () => FareAdjustment[];
    cancellation: () => CancellationCharge | null;
    pinReports: () => unknown[];
  } = {
    adjustments: () => adjustments,
    cancellation: () => cancellation,
    pinReports: () => pinReports,

    recordAdjustment: vi.fn(async (input) => {
      const existing = adjustments.find((a) => a.type === input.type);
      if (existing !== undefined) return existing;
      const row: FareAdjustment = {
        id: `adj_${adjustments.length}`,
        bookingId: input.bookingId,
        type: input.type,
        amountPaise: input.amountPaise,
        label: input.label,
        settledByPaymentId: null,
      };
      adjustments.push(row);
      return row;
    }),
    markAdjustmentsSettled: vi.fn(async () => undefined),
    listAdjustments: vi.fn(async () => adjustments),
    recordCancellationCharge: vi.fn(async (input) => {
      cancellation ??= { id: 'can_1', ...input };
      return cancellation;
    }),
    findCancellationCharge: vi.fn(async () => cancellation),
    recordPinReport: vi.fn(async (input) => {
      pinReports.push(input);
    }),
  };

  return charges;
}

function fakeLedger() {
  const entries: NewLedgerEntry[] = [];
  const ledger: LedgerWriteContract & { entries: () => NewLedgerEntry[] } = {
    entries: () => entries,
    append: vi.fn(async (batch: readonly NewLedgerEntry[]) => {
      entries.push(...batch);
      return [];
    }),
  };
  return ledger;
}

function fakeNotifications(): NotificationsContract {
  return {
    sendOffer: vi.fn(async () => 'BOTH' as const),
    cancelOffer: vi.fn(async () => undefined),
    sendBookingUpdate: vi.fn(async () => undefined),
  };
}

function fakePayments(payment: Partial<Payment> = {}) {
  const stored: Payment = {
    id: 'pay_1',
    bookingId: 'bkg_1',
    customerId: 'cus_1',
    kind: 'BOOKING',
    status: 'CAPTURED',
    amountPaise: 105_000,
    refundedPaise: 0,
    gatewayRef: 'mock_pay_1',
    idempotencyKey: 'idem_1',
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...payment,
  };

  const refunds: Array<{ amountPaise?: number | undefined }> = [];

  const payments: PaymentsContract & { refunds: () => typeof refunds } = {
    refunds: () => refunds,
    charge: vi.fn(async () => ({ payment: stored, clientToken: 'mock_token' })),
    refund: vi.fn(async (input) => {
      refunds.push({ amountPaise: input.amountPaise });
      return stored;
    }),
    findById: vi.fn(async () => stored),
    listForBooking: vi.fn(async () => [stored]),
  };

  return payments;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the transition table', () => {
  it('covers every status, so a new one cannot be added without a decision', () => {
    for (const status of ALL_STATUSES) {
      expect(TRANSITIONS[status]).toBeDefined();
    }
  });

  it('starts a booking at PENDING_PAYMENT, never at CONFIRMED', () => {
    // Payment precedes confirmation. A booking that could reach CONFIRMED without a captured
    // payment would be a free ride.
    expect(TRANSITIONS.PENDING_PAYMENT).toContain('CONFIRMED');
    expect(canTransition('PENDING_PAYMENT', 'SEARCHING')).toBe(false);
    expect(canTransition('PENDING_PAYMENT', 'ASSIGNED')).toBe(false);
  });

  it('makes every terminal status genuinely terminal', () => {
    for (const status of [
      'COMPLETED',
      'CANCELLED_BY_CUSTOMER',
      'CANCELLED_BY_DRIVER',
      'CANCELLED_BY_ADMIN',
      'EXPIRED',
    ] as const) {
      expect(isTerminal(status)).toBe(true);
    }
  });

  it('lets only an admin touch a trip that has started', () => {
    expect(TRANSITIONS.STARTED).toEqual(['COMPLETED', 'CANCELLED_BY_ADMIN']);
  });

  it('allows reassignment back to SEARCHING from every driver-held status', () => {
    for (const status of ['ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED'] as const) {
      expect(canTransition(status, 'SEARCHING')).toBe(true);
    }
  });
});

describe('generateReference', () => {
  it('avoids characters that are ambiguous read aloud', () => {
    const reference = generateReference(() => 0.999999);
    expect(reference).toMatch(/^DZ-[023456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    expect(reference).not.toMatch(/[O1I]/);
  });
});

describe('isScheduledBooking', () => {
  const now = new Date('2026-08-31T09:00:00Z');

  it('treats an hour or less out as immediate', () => {
    expect(isScheduledBooking(new Date('2026-08-31T09:30:00Z'), now)).toBe(false);
    expect(isScheduledBooking(new Date('2026-08-31T10:00:00Z'), now)).toBe(false);
  });

  it('treats more than an hour out as scheduled', () => {
    expect(isScheduledBooking(new Date('2026-08-31T10:30:00Z'), now)).toBe(true);
  });
});

describe('distance and fix freshness', () => {
  it('measures a short hop in metres', () => {
    // ~1.1 km north of the pickup.
    expect(distanceMetres(PICKUP, { lat: 26.7371, lng: 88.3953 })).toBeGreaterThan(1_000);
    expect(distanceMetres(PICKUP, { lat: 26.7371, lng: 88.3953 })).toBeLessThan(1_200);
  });

  it('calls a point on top of the pickup zero metres away', () => {
    expect(distanceMetres(PICKUP, PICKUP)).toBe(0);
  });

  it('refuses a fix older than a minute', () => {
    const now = new Date('2026-08-31T09:00:00Z');
    expect(isFixStale(new Date('2026-08-31T08:59:30Z'), now)).toBe(false);
    expect(isFixStale(new Date('2026-08-31T08:55:00Z'), now)).toBe(true);
  });
});

describe('DriverArrivedUseCase — the geofence gate', () => {
  const fresh = new Date();

  function build(seed: Booking) {
    const repo = fakeRepo(seed);
    const ledger = fakeLedger();
    return {
      repo,
      ledger,
      useCase: new DriverArrivedUseCase(repo, settings, ledger, fakeNotifications()),
    };
  }

  it('refuses a driver 2 km away, and says how far', async () => {
    const { repo, useCase } = build(booking());

    await expect(
      useCase.execute({
        bookingId: 'bkg_1',
        driverId: 'drv_1',
        location: { lat: 26.745, lng: 88.3953 },
        fixTakenAt: fresh,
      }),
    ).rejects.toMatchObject({
      code: 'DRIVER_NOT_AT_PICKUP',
      statusCode: 422,
      publicDetails: expect.objectContaining({ allowed_metres: 500 }),
    });

    // And crucially, the waiting clock has NOT started.
    expect(repo.current().status).toBe('DRIVER_EN_ROUTE');
    expect(repo.current().arrivedAt).toBeNull();
  });

  it('accepts a driver inside the radius', async () => {
    const { repo, useCase } = build(booking());

    const arrived = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      location: { lat: 26.7274, lng: 88.3955 },
      fixTakenAt: fresh,
    });

    expect(arrived.status).toBe('ARRIVED');
    expect(repo.current().arrivedAt).not.toBeNull();
  });

  it('refuses a stale fix rather than trusting it', async () => {
    const { useCase } = build(booking());

    await expect(
      useCase.execute({
        bookingId: 'bkg_1',
        driverId: 'drv_1',
        location: PICKUP,
        fixTakenAt: new Date(Date.now() - 5 * 60_000),
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_LOCATION_STALE' });
  });

  it("hides another driver's booking as a 404, not a 403", async () => {
    const { useCase } = build(booking({ driverId: 'drv_someone_else' }));

    await expect(
      useCase.execute({
        bookingId: 'bkg_1',
        driverId: 'drv_1',
        location: PICKUP,
        fixTakenAt: fresh,
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND', statusCode: 404 });
  });

  it('debits a late driver, and never charges the customer for it', async () => {
    // Scheduled 09:00, grace 10 min. Arriving now is far beyond that.
    const { ledger, useCase } = build(booking({ scheduledAt: new Date(Date.now() - 60 * 60_000) }));

    const arrived = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      location: PICKUP,
      fixTakenAt: fresh,
    });

    const penalty = ledger.entries().find((e) => e.entryType === 'PENALTY');
    expect(penalty?.amountPaise).toBe(-5_000); // ₹50, the registry default
    expect(penalty?.driverId).toBe('drv_1');

    // The customer's frozen fare is untouched — B-1.
    expect(arrived.fareSnapshot.fare.totalPaise).toBe(105_000);
  });

  it('does not fine a driver inside the grace period', async () => {
    const { ledger, useCase } = build(booking({ scheduledAt: new Date(Date.now() - 5 * 60_000) }));

    await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      location: PICKUP,
      fixTakenAt: fresh,
    });

    expect(ledger.entries().filter((e) => e.entryType === 'PENALTY')).toHaveLength(0);
  });
});

describe('StartTripUseCase — the trip OTP', () => {
  function build(seed: Booking, otp = '4821') {
    const repo = fakeRepo(seed, otp);
    return { repo, useCase: new StartTripUseCase(repo, settings, fakeNotifications()) };
  }

  const arrived = () => booking({ status: 'ARRIVED', arrivedAt: new Date() });

  it('starts the trip on the right code', async () => {
    const { useCase } = build(arrived());
    const started = await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', otp: '4821' });
    expect(started.status).toBe('STARTED');
    expect(started.startedAt).not.toBeNull();
  });

  it('refuses the wrong code and counts the attempt', async () => {
    const { repo, useCase } = build(arrived());

    await expect(
      useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', otp: '0000' }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });

    expect(repo.current().otpAttempts).toBe(1);
    expect(repo.current().status).toBe('ARRIVED');
  });

  it('locks after five wrong codes', async () => {
    const { useCase } = build(arrived());

    for (let i = 0; i < MAX_OTP_ATTEMPTS - 1; i += 1) {
      await expect(
        useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', otp: '0000' }),
      ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    }

    await expect(
      useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', otp: '0000' }),
    ).rejects.toMatchObject({ code: 'OTP_LOCKED' });

    // And the right code no longer helps — support has to intervene.
    await expect(
      useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', otp: '4821' }),
    ).rejects.toMatchObject({ code: 'OTP_LOCKED' });
  });

  it('WARNS rather than blocks when the driver is far from the pickup', async () => {
    // The asymmetry with Arrive: the customer is in the car by now, so refusing would strand a
    // trip that is genuinely happening.
    const { repo, useCase } = build(arrived());

    const started = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      otp: '4821',
      location: { lat: 26.79, lng: 88.3953 },
    });

    expect(started.status).toBe('STARTED');

    const event = repo.events().find((e) => e.toStatus === 'STARTED');
    expect(event?.metadata['startedAwayFromPickup']).toBe(true);
  });
});

describe('CompleteTripUseCase — settlement', () => {
  function build(seed: Booking) {
    const repo = fakeRepo(seed);
    const charges = fakeCharges();
    const ledger = fakeLedger();
    const payments = fakePayments();
    return {
      repo,
      charges,
      ledger,
      payments,
      useCase: new CompleteTripUseCase(
        repo,
        charges,
        settings,
        ledger,
        payments,
        fakeNotifications(),
      ),
    };
  }

  /** Arrived 09:00, started 09:40 — 40 minutes waited, 15 free, 25 chargeable at ₹2. */
  const lateCustomer = () =>
    booking({
      status: 'STARTED',
      arrivedAt: new Date('2026-08-31T09:00:00Z'),
      startedAt: new Date('2026-08-31T09:40:00Z'),
    });

  it('charges the customer only for the minutes past the free window', async () => {
    const { charges, useCase } = build(lateCustomer());
    const result = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      idempotencyKey: 'k1',
    });

    expect(result.waitingChargePaise).toBe(5_000); // 25 × ₹2
    expect(charges.adjustments()).toHaveLength(1);
    expect(charges.adjustments()[0]?.label).toMatch(/25 min beyond the free 15/);
  });

  it('credits the waiting charge to the driver IN FULL, uncommissioned', async () => {
    const { ledger, useCase } = build(lateCustomer());
    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'k1' });

    const waiting = ledger.entries().find((e) => e.entryType === 'WAITING_EARNING');
    expect(waiting?.amountPaise).toBe(5_000);

    const trip = ledger.entries().find((e) => e.entryType === 'TRIP_EARNING');
    expect(trip?.amountPaise).toBe(77_250); // the driver's share of the FROZEN subtotal
  });

  it('writes no cash-collected row, because the fare was prepaid', async () => {
    const { ledger, useCase } = build(lateCustomer());
    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'k1' });
    expect(ledger.entries().some((e) => e.entryType === 'CASH_COLLECTED')).toBe(false);
  });

  it('never edits the frozen fare snapshot', async () => {
    const { repo, useCase } = build(lateCustomer());
    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'k1' });

    expect(repo.current().fareSnapshot.fare.totalPaise).toBe(105_000);
    expect(repo.current().fareSnapshot.fare.lines).toHaveLength(1);
  });

  it('charges nothing when the customer was on time', async () => {
    const { charges, ledger, useCase } = build(
      booking({
        status: 'STARTED',
        arrivedAt: new Date('2026-08-31T09:00:00Z'),
        startedAt: new Date('2026-08-31T09:10:00Z'),
      }),
    );

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      idempotencyKey: 'k1',
    });

    expect(result.waitingChargePaise).toBe(0);
    expect(charges.adjustments()).toHaveLength(0);
    expect(ledger.entries().some((e) => e.entryType === 'WAITING_EARNING')).toBe(false);
  });

  it('caps a very long wait', async () => {
    const { useCase } = build(
      booking({
        status: 'STARTED',
        arrivedAt: new Date('2026-08-31T09:00:00Z'),
        startedAt: new Date('2026-08-31T14:00:00Z'),
      }),
    );

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      idempotencyKey: 'k1',
    });

    expect(result.waitingChargePaise).toBe(30_000); // waiting.max_charge, ₹300
  });

  it('settles the extras as a second payment, not an edit to the first', async () => {
    const { payments, useCase } = build(lateCustomer());
    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'k1' });

    expect(payments.charge).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SETTLEMENT', amountPaise: 5_000 }),
    );
  });
});

describe('CancelBookingByCustomerUseCase — the ladder', () => {
  function build(seed: Booking) {
    const repo = fakeRepo(seed);
    const charges = fakeCharges();
    const payments = fakePayments();
    return {
      repo,
      charges,
      payments,
      useCase: new CancelBookingByCustomerUseCase(
        repo,
        charges,
        settings,
        payments,
        fakeNotifications(),
      ),
    };
  }

  it('is free before the driver sets off, and refunds everything', async () => {
    const { payments, useCase } = build(booking({ status: 'ASSIGNED' }));

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      actorId: 'cus_1',
      reason: 'Plans changed',
    });

    expect(result.feePaise).toBe(0);
    expect(result.refundedPaise).toBe(105_000);
    expect(payments.refunds()).toEqual([{ amountPaise: 105_000 }]);
  });

  it('charges ₹50 once the driver is en route, and refunds the rest', async () => {
    const { charges, useCase } = build(
      booking({
        status: 'DRIVER_EN_ROUTE',
        assignedAt: new Date(),
        createdAt: new Date(Date.now() - 60 * 60_000),
      }),
    );

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      actorId: 'cus_1',
      reason: 'No longer needed',
    });

    expect(result.feePaise).toBe(5_000);
    expect(result.refundedPaise).toBe(100_000);
    expect(charges.cancellation()).toMatchObject({ chargedTo: 'CUSTOMER', amountPaise: 5_000 });
  });

  it('charges ₹100 even when the booking was confirmed seconds ago', async () => {
    // A fresh booking whose driver already arrived: the blunt free window must NOT excuse it.
    const { useCase } = build(booking({ status: 'ARRIVED', assignedAt: new Date() }));

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      actorId: 'cus_1',
      reason: 'Changed my mind',
    });

    expect(result.feePaise).toBe(10_000);
    expect(result.refundedPaise).toBe(95_000);
  });

  it('never edits the fare snapshot when charging a fee', async () => {
    const { repo, useCase } = build(booking({ status: 'ARRIVED', assignedAt: new Date() }));

    await useCase.execute({ bookingId: 'bkg_1', actorId: 'cus_1', reason: 'Changed my mind' });
    expect(repo.current().fareSnapshot.fare.totalPaise).toBe(105_000);
  });

  it('refuses to cancel without a reason', async () => {
    const { useCase } = build(booking({ status: 'ASSIGNED' }));

    await expect(
      useCase.execute({ bookingId: 'bkg_1', actorId: 'cus_1', reason: '   ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('never refuses to cancel, at any cancellable status', async () => {
    // The fee is the deterrent; a customer who cannot cancel no-shows instead.
    for (const status of ['CONFIRMED', 'SEARCHING', 'ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED'] as const) {
      const { useCase } = build(booking({ status }));
      const result = await useCase.execute({
        bookingId: 'bkg_1',
        actorId: 'cus_1',
        reason: 'Testing the ladder',
      });
      expect(result.booking.status).toBe('CANCELLED_BY_CUSTOMER');
    }
  });
});

describe('the event log', () => {
  it('always carries a metadata object, even for a transition that had none', async () => {
    // Mongoose drops an empty Mixed object, so the mapper has to restore it. The contract types
    // `metadata` as non-optional, and a client reading `event.metadata.x` would otherwise throw
    // on precisely the transitions that went fine.
    const repo = fakeRepo(booking({ status: 'ASSIGNED' }));
    await repo.transition({
      bookingId: 'bkg_1',
      from: 'ASSIGNED',
      to: 'DRIVER_EN_ROUTE',
      actor: { type: 'DRIVER', id: 'drv_1' },
    });

    const events = await repo.listEvents('bkg_1');
    for (const event of events) {
      expect(event.metadata).toBeDefined();
      expect(typeof event.metadata).toBe('object');
    }
  });
});
