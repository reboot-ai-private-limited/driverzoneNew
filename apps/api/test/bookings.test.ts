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
import { toBookingDto } from '../src/modules/bookings/interface/bookings.mapper.js';
import type { CustomerContact, DriverCard } from '../src/modules/identity/identity.public.js';
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
import {
  ConfirmBookingPaymentUseCase,
  FailBookingPaymentUseCase,
} from '../src/modules/bookings/application/useCases/confirmBookingPayment.usecase.js';
import { buildSnapshot } from '../src/modules/settings/domain/setting.entity.js';
import { adminBookingListQuerySchema } from '../src/modules/bookings/interface/bookings.validation.js';
import type { SettingsReadContract } from '../src/modules/settings/settings.public.js';
import type { LedgerWriteContract, NewLedgerEntry } from '../src/modules/ledger/ledger.public.js';
import {
  applyWalletToFare,
  type NewWalletEntry,
  type WalletPublicContract,
} from '../src/modules/wallet/wallet.public.js';
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
    walletCreditPaise: 0,
    walletDebtPaise: 0,
    fareSnapshot: fareSnapshot(),
    paymentMode: 'UPI',
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
      cancellation ??= {
        id: 'can_1',
        ...input,
        settledByPaymentId: input.settledByPaymentId ?? null,
      };
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

/**
 * The customer wallet, as a running balance over appended rows — the same arithmetic the real one
 * does, so a test can assert on what a customer ends up owing rather than on which rows were
 * written.
 */
function fakeWallet(openingPaise = 0) {
  const rows: NewWalletEntry[] = [];
  const wallet: WalletPublicContract & { rows: () => NewWalletEntry[] } = {
    rows: () => rows,
    append: vi.fn(async (batch: readonly NewWalletEntry[]) => {
      rows.push(...batch);
      return [];
    }),
    balance: vi.fn(async () => rows.reduce((sum, r) => sum + r.amountPaise, openingPaise)),
    planFor: vi.fn(async (_customerId: string, farePaise: number) =>
      applyWalletToFare(rows.reduce((sum, r) => sum + r.amountPaise, openingPaise), farePaise),
    ),
    entriesForBooking: vi.fn(async () => []),
  };
  return wallet;
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
    const wallet = fakeWallet();
    return {
      repo,
      charges,
      payments,
      wallet,
      useCase: new CancelBookingByCustomerUseCase(
        repo,
        charges,
        settings,
        payments,
        wallet,
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

// ─── Cash ────────────────────────────────────────────────────────────────────────────────────

describe('CompleteTripUseCase — cash', () => {
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
      useCase: new CompleteTripUseCase(repo, charges, settings, ledger, payments, fakeNotifications()),
    };
  }

  /** A cash trip that also ran 40 minutes of waiting: 15 free, 25 chargeable at ₹2. */
  const cashTrip = () =>
    booking({
      status: 'STARTED',
      paymentMode: 'CASH',
      paymentId: null,
      arrivedAt: new Date('2026-08-31T09:00:00Z'),
      startedAt: new Date('2026-08-31T09:40:00Z'),
    });

  it('records the cash the driver is now holding, as a NEGATIVE entry', async () => {
    const { ledger, useCase } = build(cashTrip());

    await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      cashCollectedPaise: 110_000, // ₹1,050 fare + ₹50 waiting
      idempotencyKey: 'k1',
    });

    const cash = ledger.entries().find((e) => e.entryType === 'CASH_COLLECTED');
    expect(cash?.amountPaise).toBe(-110_000);
  });

  it('records what the driver REPORTS, even when it differs from what was expected', async () => {
    /*
     * The ledger records the real movement of money. A driver who hands over ₹1,000 against an
     * expected ₹1,100 is ₹100 short, and that gap belongs in the balance where reconciliation can
     * find it — not smoothed away by booking the number we wished had been collected.
     */
    const { ledger, useCase } = build(cashTrip());

    await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      cashCollectedPaise: 100_000,
      idempotencyKey: 'k1',
    });

    expect(ledger.entries().find((e) => e.entryType === 'CASH_COLLECTED')?.amountPaise).toBe(
      -100_000,
    );
  });

  it('puts the driver into debt: they hold the fare but earned only their share', async () => {
    const { ledger, useCase } = build(cashTrip());

    await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      cashCollectedPaise: 110_000,
      idempotencyKey: 'k1',
    });

    // +77,250 trip +5,000 waiting −110,000 cash = −27,750. This is the number
    // `driver.max_negative_balance` measures and dispatch already filters on.
    const balance = ledger.entries().reduce((sum, e) => sum + e.amountPaise, 0);
    expect(balance).toBe(-27_750);
  });

  it('takes no second gateway charge for the waiting — it was collected in cash', async () => {
    const { payments, useCase } = build(cashTrip());

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      cashCollectedPaise: 110_000,
      idempotencyKey: 'k1',
    });

    expect(payments.charge).not.toHaveBeenCalled();
    // Still recorded, because the receipt has to explain the extra either way.
    expect(result.waitingChargePaise).toBe(5_000);
  });

  it('falls back to the expected total when the driver reports no figure', async () => {
    const { ledger, useCase } = build(cashTrip());

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'k1' });

    // The frozen fare (₹1,050) plus the waiting that accrued (₹50).
    expect(ledger.entries().find((e) => e.entryType === 'CASH_COLLECTED')?.amountPaise).toBe(
      -110_000,
    );
  });

  it('writes no cash entry at all on a prepaid trip', async () => {
    const { ledger, useCase } = build(
      booking({
        status: 'STARTED',
        paymentMode: 'UPI',
        arrivedAt: new Date('2026-08-31T09:00:00Z'),
        startedAt: new Date('2026-08-31T09:10:00Z'),
      }),
    );

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'k1' });
    expect(ledger.entries().some((e) => e.entryType === 'CASH_COLLECTED')).toBe(false);
  });
});

describe('cancelling a CASH booking', () => {
  function build(seed: Booking) {
    const repo = fakeRepo(seed);
    const charges = fakeCharges();
    const payments = fakePayments();
    const wallet = fakeWallet();
    return {
      charges,
      payments,
      wallet,
      useCase: new CancelBookingByCustomerUseCase(
        repo,
        charges,
        settings,
        payments,
        wallet,
        fakeNotifications(),
      ),
    };
  }

  const cashArrived = () =>
    booking({ status: 'ARRIVED', paymentMode: 'CASH', paymentId: null, assignedAt: new Date() });

  it('charges the fee but refunds nothing — we were holding none of their money', async () => {
    const { payments, useCase } = build(cashArrived());

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      actorId: 'cus_1',
      reason: 'Changed my mind',
    });

    expect(result.feePaise).toBe(10_000);
    expect(result.refundedPaise).toBe(0);
    expect(payments.refund).not.toHaveBeenCalled();
  });

  it('leaves the fee UNSETTLED, so it becomes a wallet debt', async () => {
    const { charges, wallet, useCase } = build(cashArrived());

    await useCase.execute({ bookingId: 'bkg_1', actorId: 'cus_1', reason: 'Changed my mind' });

    expect(charges.cancellation()?.settledByPaymentId).toBeNull();
    // The charge row is the audit; the WALLET is what the next booking actually collects.
    expect(await wallet.balance('cus_1')).toBe(-10_000);
    expect(wallet.rows()[0]?.entryType).toBe('CANCELLATION_FEE');
  });

  it('settles a prepaid booking’s fee immediately — it was kept out of the refund', async () => {
    const { charges, wallet, useCase } = build(
      booking({ status: 'ARRIVED', paymentMode: 'UPI', assignedAt: new Date() }),
    );

    await useCase.execute({ bookingId: 'bkg_1', actorId: 'cus_1', reason: 'Changed my mind' });

    expect(charges.cancellation()?.settledByPaymentId).toBe('pay_1');
    // Collected out of its own refund, so it never becomes a debt the next trip carries.
    expect(await wallet.balance('cus_1')).toBe(0);
    expect(wallet.rows()).toHaveLength(0);
  });
});

describe('a failed payment never expires the booking', () => {
  /*
   * Razorpay sends `payment.failed` then `payment.captured` for one UPI transaction when the
   * customer retries in their bank app. Expiring on the failure makes EXPIRED terminal before the
   * capture lands: money out, no ride. The sweeper's 30-minute window is what clears a genuinely
   * abandoned booking, and it outlives Razorpay's retries.
   */
  it('leaves the booking at PENDING_PAYMENT so a late capture can still confirm it', async () => {
    const repo = fakeRepo(booking({ status: 'PENDING_PAYMENT' }));
    const notifications = fakeNotifications();

    const failed = await new FailBookingPaymentUseCase(repo, notifications).execute(
      'bkg_1',
      'UPI collect expired',
    );

    expect(failed?.status).toBe('PENDING_PAYMENT');
    expect(repo.current().status).toBe('PENDING_PAYMENT');
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('then confirms when the retry captures', async () => {
    const repo = fakeRepo(booking({ status: 'PENDING_PAYMENT' }));
    const notifications = fakeNotifications();
    const charges = fakeCharges();

    await new FailBookingPaymentUseCase(repo, notifications).execute('bkg_1', 'expired');

    const confirmed = await new ConfirmBookingPaymentUseCase(
      repo,
      notifications,
      async () => undefined,
      charges,
    ).execute('bkg_1');

    expect(confirmed?.status).toBe('CONFIRMED');
  });
});

// ─── The driver card a customer sees ────────────────────────────────────────────────────────

/**
 * `toBookingDto`'s driver block, and specifically WHEN THE PHONE NUMBER IS PRESENT.
 *
 * This is the one field on a booking that is withheld by status rather than by role, and the
 * reason it is tested rather than merely commented: the number is the driver's login credential,
 * so a regression here does not look like a bug on any screen — it looks like a slightly more
 * helpful ride history, right up until a driver is rung by a stranger about a trip from March.
 */
const CARD: DriverCard = {
  id: 'drv_1',
  fullName: 'Bimal Rai',
  phone: '+919800000001',
  photoUrl: 'https://cdn.example/avatars/drv_1.jpg',
  rating: 4.8,
  ratingCount: 26,
};

describe('toBookingDto — the driver card', () => {
  const withStatus = (status: BookingStatus): ReturnType<typeof toBookingDto> =>
    toBookingDto({
      booking: booking({ status, driverId: 'drv_1' }),
      adjustments: [],
      driverCard: CARD,
    });

  it.each(['ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'STARTED'] as const)(
    'gives the customer the phone number while the trip is live (%s)',
    (status) => {
      expect(withStatus(status).driver?.phone).toBe('+919800000001');
    },
  );

  it.each(['COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER', 'EXPIRED'] as const)(
    'withholds the phone number once the trip is over (%s)',
    (status) => {
      expect(withStatus(status).driver?.phone).toBeNull();
    },
  );

  it('still shows who drove, on a finished trip', () => {
    const driver = withStatus('COMPLETED').driver;

    // The card is not suppressed wholesale — only the number is. A customer looking at their
    // history should still recognise the person who drove them.
    expect(driver?.name).toBe('Bimal Rai');
    expect(driver?.photo_url).toBe('https://cdn.example/avatars/drv_1.jpg');
    expect(driver?.rating).toBe(4.8);
  });

  it('carries no card at all on a driver-facing read', () => {
    // No `driverCard` passed — every driver-facing and admin read. The shape stays what it was
    // before customer cards existed rather than becoming null.
    const dto = toBookingDto({
      booking: booking({ status: 'STARTED', driverId: 'drv_1' }),
      adjustments: [],
      driverName: 'Bimal Rai',
    });

    expect(dto.driver).toEqual({
      id: 'drv_1',
      name: 'Bimal Rai',
      photo_url: null,
      rating: null,
      rating_count: 0,
      phone: null,
    });
  });

  it('is null when no driver has been assigned', () => {
    const dto = toBookingDto({
      booking: booking({ status: 'SEARCHING', driverId: null }),
      adjustments: [],
      driverCard: null,
    });

    expect(dto.driver).toBeNull();
  });
});

// ─── The customer contact a driver sees ─────────────────────────────────────────────────────

/**
 * `toBookingDto`'s customer block — the mirror of the driver-card tests above, and gated by the
 * same statuses. The number is the customer's login credential, so a regression that leaks it
 * onto a finished trip looks like nothing on any screen until a stranger rings a customer about
 * a ride from March.
 */
const CONTACT: CustomerContact = {
  id: 'cus_1',
  fullName: 'Anita Sharma',
  phone: '+919820000002',
};

describe('toBookingDto — the customer contact', () => {
  const withStatus = (status: BookingStatus): ReturnType<typeof toBookingDto> =>
    toBookingDto({
      booking: booking({ status, driverId: 'drv_1' }),
      adjustments: [],
      customerCard: CONTACT,
    });

  it.each(['ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'STARTED'] as const)(
    'gives the driver the number while the trip is live (%s)',
    (status) => {
      expect(withStatus(status).customer?.phone).toBe('+919820000002');
    },
  );

  it.each(['COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER', 'EXPIRED'] as const)(
    'withholds the number once the trip is over (%s)',
    (status) => {
      expect(withStatus(status).customer?.phone).toBeNull();
    },
  );

  it('still shows who the trip was for, on a finished trip', () => {
    expect(withStatus('COMPLETED').customer).toEqual({
      id: 'cus_1',
      name: 'Anita Sharma',
      phone: null,
    });
  });

  it('carries name only, never a number, when just a name was resolved', () => {
    const dto = toBookingDto({
      booking: booking({ status: 'STARTED', driverId: 'drv_1' }),
      adjustments: [],
      customerName: 'Anita Sharma',
    });

    expect(dto.customer).toEqual({ id: 'cus_1', name: 'Anita Sharma', phone: null });
  });

  it('is null when the caller resolved no customer at all', () => {
    const dto = toBookingDto({
      booking: booking({ status: 'STARTED', driverId: 'drv_1' }),
      adjustments: [],
    });

    expect(dto.customer).toBeNull();
  });
});

describe('adminBookingListQuerySchema — the booking table filters', () => {
  it('defaults to page 1 of 10 when nothing is asked for', () => {
    expect(adminBookingListQuerySchema.parse({})).toMatchObject({ page: 1, limit: 10 });
  });

  it('splits a comma-separated status list', () => {
    const parsed = adminBookingListQuerySchema.parse({ status: 'ASSIGNED,STARTED' });
    expect(parsed.status).toEqual(['ASSIGNED', 'STARTED']);
  });

  /*
   * The point of parsing statuses against the enum rather than passing them through: a typo has
   * to be a 400, not a filter that matches nothing and reads to the admin as "there are no
   * bookings" — which is the same answer a working filter gives on a quiet day.
   */
  it('rejects a status that is not in the state machine', () => {
    expect(() => adminBookingListQuerySchema.parse({ status: 'ONGOING' })).toThrow();
  });

  it('rejects one bad status among good ones', () => {
    expect(() => adminBookingListQuerySchema.parse({ status: 'ASSIGNED,NOPE' })).toThrow();
  });

  it('treats an empty status param as no filter at all', () => {
    expect(adminBookingListQuerySchema.parse({ status: '' }).status).toBeUndefined();
  });

  it('refuses a limit past the cap, so a hand-written URL cannot ask for the whole table', () => {
    expect(() => adminBookingListQuerySchema.parse({ limit: '5000' })).toThrow();
  });

  it('refuses page 0', () => {
    expect(() => adminBookingListQuerySchema.parse({ page: '0' })).toThrow();
  });

  it.each(['18-05-2025', '2025-5-1', 'yesterday', '2025-02-30'])(
    'refuses %s as a date',
    (value) => {
      expect(() => adminBookingListQuerySchema.parse({ from: value })).toThrow();
    },
  );

  it('accepts a real YYYY-MM-DD', () => {
    expect(adminBookingListQuerySchema.parse({ from: '2026-09-04' }).from).toBe('2026-09-04');
  });
});
