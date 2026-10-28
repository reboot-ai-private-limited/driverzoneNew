import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  BOOKING_STATUSES,
  type ListDriverTripsResponse,
  type BookingPaymentStatus,
  type BookingStatus,
  type PaymentMode,
} from '@driverzone/contracts';
import {
  canTransition,
  generateReference,
  isScheduledBooking,
  isTerminal,
  liveAssignmentCutoff,
  MAX_OTP_ATTEMPTS,
  TRANSITIONS,
  type Booking,
  type FareSnapshot,
} from '../src/modules/bookings/domain/booking.entity.js';
import { distanceMetres, isFixStale } from '../src/modules/bookings/domain/distance.js';
import { makeListDriverTripsController } from '../src/modules/bookings/interface/bookings.controller.js';
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
import type { BookingExtension } from '../src/modules/bookings/domain/bookingExtension.entity.js';
import type { ExtensionRepositoryPort } from '../src/modules/bookings/domain/extensionRepository.port.js';
import { DriverArrivedUseCase } from '../src/modules/bookings/application/useCases/driverArrived.usecase.js';
import { StartTripUseCase } from '../src/modules/bookings/application/useCases/startTrip.usecase.js';
import { CompleteTripUseCase } from '../src/modules/bookings/application/useCases/completeTrip.usecase.js';
import {
  CancelBookingByAdminUseCase,
  CancelBookingByCustomerUseCase,
} from '../src/modules/bookings/application/useCases/cancelBooking.usecase.js';
import {
  RequestBookingExtensionUseCase,
  RespondToExtensionUseCase,
} from '../src/modules/bookings/application/useCases/extendBooking.usecase.js';
import { totalExtension } from '../src/modules/bookings/domain/bookingExtension.entity.js';
import {
  ConfirmBookingPaymentUseCase,
  FailBookingPaymentUseCase,
} from '../src/modules/bookings/application/useCases/confirmBookingPayment.usecase.js';
import { SelectPaymentMethodUseCase } from '../src/modules/bookings/application/useCases/selectPaymentMethod.usecase.js';
import { ConfirmLatePaymentUseCase } from '../src/modules/bookings/application/useCases/confirmLatePayment.usecase.js';
import {
  VerifyExtrasPaymentUseCase,
  VerifyPaymentUseCase,
} from '../src/modules/bookings/application/useCases/verifyPayment.usecase.js';
import {
  CollectExtrasInCashUseCase,
  DriverPaymentOverrideUseCase,
  DriverSwitchToCashUseCase,
} from '../src/modules/bookings/application/useCases/driverSwitchToCash.usecase.js';
import { PayTripExtrasUseCase } from '../src/modules/bookings/application/useCases/payExtras.usecase.js';
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
        driverAmountPaise: driverPaise,
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
    paymentStatus: 'PAID',
    paymentId: 'pay_1',
    paymentReference: null,
    extrasCollection: null,
    plateNumber: null,
    rider: null,
    carCategory: null,
    vehicleType: null,
    preferFavouriteDrivers: false,
    dispatchMode: 'AUTO',
    paidExtensionPaise: 0,
    cashExtensionPaise: 0,
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
    pageForCustomer: vi.fn(async () => ({ bookings: [current], nextCursor: null })),
    customerHistorySummary: vi.fn(async () => ({ totalTrips: 1, totalSpentPaise: 0 })),
    readStartOtp: vi.fn(async () => otp),
    incrementOtpAttempts: vi.fn(async () => {
      current = { ...current, otpAttempts: current.otpAttempts + 1 };
      return current.otpAttempts;
    }),
    attachPayment: vi.fn(async () => undefined),
    setPaymentMode: vi.fn(async (id: string, mode: PaymentMode, status?: BookingPaymentStatus) => {
      if (id !== current.id) return null;
      current = {
        ...current,
        paymentMode: mode,
        ...(status !== undefined ? { paymentStatus: status } : {}),
      };
      return current;
    }),
    setPaymentStatus: vi.fn(async (id: string, status: BookingPaymentStatus) => {
      if (id === current.id) {
        current = { ...current, paymentStatus: status };
      }
    }),
    overridePaymentToCash: vi.fn(
      async (input: {
        bookingId: string;
        driverId: string;
        reason: string;
        metadata: Record<string, unknown>;
      }) => {
        if (
          input.bookingId !== current.id ||
          current.driverId !== input.driverId ||
          current.status !== 'STARTED' ||
          current.paymentStatus === 'PAID'
        ) {
          return null;
        }
        current = { ...current, paymentMode: 'CASH', paymentStatus: 'CASH' };
        events.push({
          id: `evt_${String(events.length + 1)}`,
          bookingId: current.id,
          fromStatus: 'STARTED',
          toStatus: 'STARTED',
          actorType: 'DRIVER',
          actorId: input.driverId,
          reason: input.reason,
          metadata: { paymentOverride: true, ...input.metadata },
          createdAt: new Date(),
        });
        return current;
      },
    ),
    setPaidExtensionPaise: vi.fn(async (id: string, amountPaise: number) => {
      if (id === current.id) {
        current = { ...current, paidExtensionPaise: amountPaise };
      }
    }),
    addPaidExtensionPaise: vi.fn(async (id: string, amountPaise: number) => {
      if (id === current.id) {
        current = { ...current, paidExtensionPaise: current.paidExtensionPaise + amountPaise };
      }
    }),
    addCashExtensionPaise: vi.fn(async (id: string, amountPaise: number) => {
      if (id !== current.id) return null;
      current = {
        ...current,
        paidExtensionPaise: current.paidExtensionPaise + amountPaise,
        cashExtensionPaise: current.cashExtensionPaise + amountPaise,
      };
      return current;
    }),

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

/**
 * The day-extension rows on a booking. Seeded with whatever a test wants already agreed, so the
 * completion tests can assert what an extra day does to the bill and the ledger without driving
 * the request/accept flow first — that flow has its own tests.
 */
function fakeExtensions(seed: BookingExtension[] = []) {
  const rows = [...seed];

  const repo: ExtensionRepositoryPort & { all: () => BookingExtension[] } = {
    all: () => rows,

    open: vi.fn(async (input) => {
      // The partial unique index, in memory: one PENDING request per booking, never two.
      if (rows.some((r) => r.bookingId === input.bookingId && r.status === 'PENDING')) return null;

      const row: BookingExtension = {
        id: `ext_${String(rows.length + 1)}`,
        bookingId: input.bookingId,
        customerId: input.customerId,
        driverId: input.driverId,
        status: 'PENDING',
        amountPaise: input.amountPaise,
        driverAmountPaise: input.driverAmountPaise,
        requestedAt: new Date(),
        expiresAt: input.expiresAt,
        respondedAt: null,
      };
      rows.push(row);
      return row;
    }),

    findPending: vi.fn(
      async (bookingId: string) =>
        rows.find((r) => r.bookingId === bookingId && r.status === 'PENDING') ?? null,
    ),

    listForBooking: vi.fn(async (bookingId: string) =>
      rows.filter((r) => r.bookingId === bookingId),
    ),

    respond: vi.fn(async (id: string, to, now: Date) => {
      const at = rows.findIndex((r) => r.id === id);
      const row = rows[at];
      if (row === undefined || row.status !== 'PENDING' || row.expiresAt <= now) return null;

      const updated: BookingExtension = { ...row, status: to, respondedAt: now };
      rows[at] = updated;
      return updated;
    }),

    expireStale: vi.fn(async (now: Date, limit: number) => {
      const stale = rows.filter((r) => r.status === 'PENDING' && r.expiresAt <= now).slice(0, limit);
      for (const row of stale) {
        rows[rows.indexOf(row)] = { ...row, status: 'EXPIRED', respondedAt: now };
      }
      return stale.length;
    }),
  };

  return repo;
}

/** One accepted extra day, for the completion tests. */
const acceptedExtension = (over: Partial<BookingExtension> = {}): BookingExtension => ({
  id: 'ext_1',
  bookingId: 'bkg_1',
  customerId: 'cus_1',
  driverId: 'drv_1',
  status: 'ACCEPTED',
  amountPaise: 300_000,
  driverAmountPaise: 225_000,
  requestedAt: new Date(),
  expiresAt: new Date(Date.now() + 30 * 60_000),
  respondedAt: new Date(),
  ...over,
});

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
    verifyAndCapture: vi.fn(async () => ({ captured: true, justCaptured: true })),
    publicKey: 'rzp_test_mock',
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

  /*
   * THIS USED TO ASSERT THE OPPOSITE for anything inside an hour, and the hour was a trap. A trip
   * booked at 09:00 for 09:30 came back `false` — an immediate booking carrying a 09:30 pickup —
   * so every protection that keys off this flag was withheld from it, including the waiting
   * exemption that stops a customer being billed for the driver arriving twenty minutes early.
   * See `SCHEDULED_THRESHOLD_MINUTES`.
   */
  it('treats any future pickup as scheduled, however near', () => {
    expect(isScheduledBooking(new Date('2026-08-31T09:30:00Z'), now)).toBe(true);
    expect(isScheduledBooking(new Date('2026-08-31T10:00:00Z'), now)).toBe(true);
    expect(isScheduledBooking(new Date('2026-08-31T10:30:00Z'), now)).toBe(true);
    // A minute out is still a time the customer named and expects to be kept.
    expect(isScheduledBooking(new Date('2026-08-31T09:01:00Z'), now)).toBe(true);
  });

  /*
   * An instant booking sends no `scheduledAt`, so the server stamps the QUOTE's creation time —
   * always at or before `now` by the time the booking is made. Both edges are immediate, and the
   * `now` case is the one that matters: it is what stops a clock-tick turning "Now" into a
   * scheduled trip.
   */
  it('treats now, or any past instant, as immediate', () => {
    expect(isScheduledBooking(now, now)).toBe(false);
    expect(isScheduledBooking(new Date('2026-08-31T08:55:00Z'), now)).toBe(false);
  });
});

describe('liveAssignmentCutoff — when a driver is actually on a trip they hold', () => {
  const now = new Date('2026-08-31T09:00:00Z');

  it('is the lead time ahead of now, so a pickup inside the window counts', () => {
    const cutoff = liveAssignmentCutoff(now, 90);
    expect(cutoff.toISOString()).toBe('2026-08-31T10:30:00.000Z');

    // A booking an admin pre-assigned for Wednesday is not the trip they are on this morning.
    expect(new Date('2026-09-03T06:00:00Z').getTime()).toBeGreaterThan(cutoff.getTime());
    // One picking up in an hour is.
    expect(new Date('2026-08-31T10:00:00Z').getTime()).toBeLessThan(cutoff.getTime());
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
        fakeExtensions(),
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

  /*
   * The trip booked for next week, which a customer could not cancel at all until the app grew a
   * route to the button. The API always allowed it; these pin that down so a future guard on
   * "CONFIRMED is not a real booking yet" cannot quietly take it away again.
   */
  it('cancels a scheduled booking that has not dispatched, free', async () => {
    const threeDaysOut = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    const { repo, payments, useCase } = build(
      booking({
        status: 'CONFIRMED',
        driverId: null,
        assignedAt: null,
        isScheduled: true,
        scheduledAt: threeDaysOut,
        dispatchAt: new Date(threeDaysOut.getTime() - 90 * 60_000),
      }),
    );

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      actorId: 'cus_1',
      reason: 'Plans changed',
    });

    expect(result.feePaise).toBe(0);
    expect(result.refundedPaise).toBe(105_000);
    expect(repo.current().status).toBe('CANCELLED_BY_CUSTOMER');
    expect(payments.refunds()).toEqual([{ amountPaise: 105_000 }]);
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
  /** `extensions` seeds days the driver already agreed to — see `acceptedExtension`. */
  function build(seed: Booking, extensions: BookingExtension[] = []) {
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
        fakeExtensions(extensions),
      ),
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

/**
 * `toBookingDto`'s `payable` block — the one figure both apps render as the price.
 *
 * WHY IT EXISTS. `fare` is frozen at booking time (invariant B-1) and every screen was showing it
 * as "the total", so a customer who bought an extra day saw the old number, and the driver's
 * "collect this much in cash" line under-told them by the extension, the waiting charge AND the
 * wallet credit while the server booked `expectedCashPaise`. Three renderings of one number, none
 * of which agreed.
 */
describe('toBookingDto — payable', () => {
  const extensionRow = (over: Partial<BookingExtension> = {}): BookingExtension =>
    acceptedExtension({ bookingId: 'bkg_1', ...over });

  it('adds an accepted extension to the total while the trip is still running', () => {
    const dto = toBookingDto({
      booking: booking({ status: 'STARTED', serviceType: 'OUTSTATION' }),
      adjustments: [],
      extensions: [extensionRow()],
    });

    expect(dto.fare.total.amount_paise).toBe(105_000);
    expect(dto.payable.extension_total.amount_paise).toBe(300_000);
    expect(dto.payable.total.amount_paise).toBe(405_000);
  });

  /*
   * The same money from the other source. A finished trip's extension lives on a `DAY_EXTENSION`
   * adjustment row, and a history LIST does not pay for the extensions query — so the block has
   * to add up from whichever of the two this read was given.
   */
  it('reads a finished trip’s extension off the adjustment row instead', () => {
    const dto = toBookingDto({
      booking: booking({ status: 'COMPLETED', waitingChargePaise: 5_000 }),
      adjustments: [
        {
          id: 'adj_1',
          bookingId: 'bkg_1',
          type: 'DAY_EXTENSION',
          amountPaise: 300_000,
          label: 'Extended — 1 extra day',
          settledByPaymentId: null,
        },
      ],
    });

    expect(dto.payable.extension_total.amount_paise).toBe(300_000);
    expect(dto.payable.waiting_total.amount_paise).toBe(5_000);
    expect(dto.payable.total.amount_paise).toBe(410_000);
  });

  it('never counts the same extension twice when both sources are present', () => {
    const dto = toBookingDto({
      booking: booking({ status: 'COMPLETED' }),
      adjustments: [
        {
          id: 'adj_1',
          bookingId: 'bkg_1',
          type: 'DAY_EXTENSION',
          amountPaise: 300_000,
          label: 'Extended — 1 extra day',
          settledByPaymentId: null,
        },
      ],
      extensions: [extensionRow()],
    });

    expect(dto.payable.extension_total.amount_paise).toBe(300_000);
  });

  it('takes wallet credit off the total, the way the driver’s cash line has to', () => {
    const dto = toBookingDto({
      booking: booking({ status: 'STARTED', paymentMode: 'CASH', walletCreditPaise: 20_000 }),
      adjustments: [],
      extensions: [],
    });

    expect(dto.payable.total.amount_paise).toBe(85_000);
  });

  it('reports an unpaid extension as outstanding on a UPI trip', () => {
    const dto = toBookingDto({
      booking: booking({ status: 'STARTED', paymentMode: 'UPI', paidExtensionPaise: 0 }),
      adjustments: [],
      extensions: [extensionRow()],
    });

    expect(dto.payable.outstanding.amount_paise).toBe(300_000);
  });

  it('reports nothing outstanding once that extension has been collected', () => {
    const dto = toBookingDto({
      booking: booking({ status: 'STARTED', paymentMode: 'UPI', paidExtensionPaise: 300_000 }),
      adjustments: [],
      extensions: [extensionRow()],
    });

    expect(dto.payable.outstanding.amount_paise).toBe(0);
  });

  /*
   * A FINISHED TRIP ASKS FOR NOTHING, even carrying an extension nobody collected — one completed
   * before the gate existed, say. `PayTripExtrasUseCase` refuses anything but STARTED, so a
   * non-zero figure here would put a Pay button on the customer's screen that 400s on every press.
   */
  it('reports nothing outstanding once the trip is over', () => {
    const dto = toBookingDto({
      booking: booking({ status: 'COMPLETED', paymentMode: 'UPI', paidExtensionPaise: 0 }),
      adjustments: [],
      extensions: [extensionRow()],
    });

    expect(dto.payable.outstanding.amount_paise).toBe(0);
    // Still counted in what the trip cost — it is a receivable, not a discount.
    expect(dto.payable.total.amount_paise).toBe(405_000);
  });

  /* Cash collects everything at the door, so there is never an online payment to prompt for. */
  it('reports nothing outstanding on a cash trip', () => {
    const dto = toBookingDto({
      booking: booking({ status: 'STARTED', paymentMode: 'CASH' }),
      adjustments: [],
      extensions: [extensionRow()],
    });

    expect(dto.payable.outstanding.amount_paise).toBe(0);
    // Still in the total: the driver collects it, it is just not a checkout.
    expect(dto.payable.total.amount_paise).toBe(405_000);
  });
});

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

describe('toBookingDto — booking for someone else', () => {
  const RIDER = { name: 'Ramesh Das', phone: '+919811111111' };
  const withStatus = (status: BookingStatus, revealPhones?: boolean): ReturnType<typeof toBookingDto> =>
    toBookingDto({
      booking: booking({ status, driverId: 'drv_1', rider: RIDER }),
      adjustments: [],
      ...(revealPhones === undefined ? {} : { revealPhones }),
    });

  it('is null when the customer is travelling themselves', () => {
    expect(toBookingDto({ booking: booking(), adjustments: [] }).rider).toBeNull();
  });

  it.each(['ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'STARTED'] as const)(
    "carries the passenger's number while the trip is live (%s)",
    (status) => {
      expect(withStatus(status).rider).toEqual(RIDER);
    },
  );

  it.each(['CONFIRMED', 'SEARCHING', 'COMPLETED', 'CANCELLED_BY_CUSTOMER'] as const)(
    "keeps the passenger's name but withholds the number outside the live trip (%s)",
    (status) => {
      // The same gate as the two parties' own numbers: a driver does not keep a passenger's
      // number after the trip, but everyone can still see who the trip was for.
      expect(withStatus(status).rider).toEqual({ name: 'Ramesh Das', phone: null });
    },
  );

  it('shows the number to an admin whatever the status', () => {
    expect(withStatus('COMPLETED', true).rider?.phone).toBe('+919811111111');
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

// ─── Admin cancellation ──────────────────────────────────────────────────────────────────────

describe('CancelBookingByAdminUseCase', () => {
  function build(seed: Booking) {
    const repo = fakeRepo(seed);
    const payments = fakePayments();
    const charges = fakeCharges();
    const wallet = fakeWallet();
    const ledger = fakeLedger();

    return {
      repo,
      payments,
      charges,
      wallet,
      ledger,
      useCase: new CancelBookingByAdminUseCase(repo, payments, fakeNotifications()),
    };
  }

  it('charges nobody, whatever the ladder would have said', async () => {
    // ARRIVED is the most expensive rung on both ladders — the customer's fee and the driver's
    // penalty are both at their highest here. An admin cancellation reads neither.
    const { useCase, charges, wallet, ledger } = build(
      booking({ status: 'ARRIVED', arrivedAt: new Date() }),
    );

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      actorId: 'adm_1',
      reason: 'Driver broke down and nobody else is free',
    });

    expect(result.feePaise).toBe(0);
    expect(charges.cancellation()).toBeNull();
    expect(wallet.rows()).toHaveLength(0);
    expect(ledger.entries()).toHaveLength(0);
  });

  it('refunds a prepaid booking in full', async () => {
    const { useCase, payments } = build(booking({ status: 'ASSIGNED' }));

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      actorId: 'adm_1',
      reason: 'Ops cancelled',
    });

    // The whole captured amount, with nothing kept back — there is no fee to keep.
    expect(payments.refunds()).toEqual([{ amountPaise: 105_000 }]);
    expect(result.refundedPaise).toBe(105_000);
  });

  it('refunds nothing on a cash booking, because nothing was ever collected', async () => {
    const { useCase, payments } = build(
      booking({ status: 'ASSIGNED', paymentMode: 'CASH', paymentId: null }),
    );

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      actorId: 'adm_1',
      reason: 'Ops cancelled',
    });

    expect(payments.refunds()).toHaveLength(0);
    expect(result.refundedPaise).toBe(0);
  });

  it('records the zero fee on the event, rather than leaving the field out', async () => {
    // An absent field reads as "nobody wrote it down", which is the same shape as a bug. The
    // event log is what answers "was I charged for this" weeks later.
    const { useCase, repo } = build(booking({ status: 'ASSIGNED' }));

    await useCase.execute({ bookingId: 'bkg_1', actorId: 'adm_1', reason: 'Ops cancelled' });

    const event = repo.events().at(-1);
    expect(event?.toStatus).toBe('CANCELLED_BY_ADMIN');
    expect(event?.metadata).toMatchObject({ feePaise: 0 });
    expect(event?.actorId).toBe('adm_1');
  });

  it('demands a reason', async () => {
    const { useCase } = build(booking({ status: 'ASSIGNED' }));

    await expect(
      useCase.execute({ bookingId: 'bkg_1', actorId: 'adm_1', reason: '   ' }),
    ).rejects.toThrow();
  });

  it('refuses a booking that is already finished', async () => {
    const { useCase } = build(booking({ status: 'COMPLETED' }));

    await expect(
      useCase.execute({ bookingId: 'bkg_1', actorId: 'adm_1', reason: 'Too late' }),
    ).rejects.toThrow();
  });
});

// ─── Day extensions ──────────────────────────────────────────────────────────────────────────

/** An outstation snapshot carrying the frozen day rate an extension is priced from. */
function outstationSnapshot(): FareSnapshot {
  const base = fareSnapshot();
  return {
    ...base,
    serviceType: 'OUTSTATION',
    fare: {
      ...base.fare,
      serviceType: 'OUTSTATION',
      perDay: { days: 2, farePaise: 300_000, driverAmountPaise: 225_000 },
    },
  };
}

/** A running outstation trip — the only shape that can be extended. */
const runningOutstation = (over: Partial<Booking> = {}): Booking =>
  booking({
    status: 'STARTED',
    serviceType: 'OUTSTATION',
    fareSnapshot: outstationSnapshot(),
    startedAt: new Date(),
    ...over,
  });

describe('RequestBookingExtensionUseCase', () => {
  function build(seed: Booking, extensions: BookingExtension[] = []) {
    const repo = fakeRepo(seed);
    const rows = fakeExtensions(extensions);
    return {
      repo,
      rows,
      useCase: new RequestBookingExtensionUseCase(repo, rows, settings, fakeNotifications()),
    };
  }

  it('opens a pending request priced at exactly one day', async () => {
    const { useCase } = build(runningOutstation());

    const extension = await useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1' });

    expect(extension.status).toBe('PENDING');
    // One day's BAND FARE — not a share of the pickup fee, surcharge or insurance, which are
    // properties of the trip and were charged once.
    expect(extension.amountPaise).toBe(300_000);
    expect(extension.driverAmountPaise).toBe(225_000);
  });

  it('charges nothing at the moment it is asked for', async () => {
    // The whole point of driver consent: a request is not a purchase.
    const { useCase, rows } = build(runningOutstation());

    await useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1' });

    expect(rows.all().every((row) => row.status === 'PENDING')).toBe(true);
  });

  it('refuses a trip that has not started yet', async () => {
    const { useCase } = build(runningOutstation({ status: 'ASSIGNED' }));

    await expect(
      useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1' }),
    ).rejects.toThrow(/started/i);
  });

  it('refuses an incity trip, which has no day to sell', async () => {
    const { useCase } = build(booking({ status: 'STARTED', startedAt: new Date() }));

    await expect(
      useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1' }),
    ).rejects.toThrow(/outstation/i);
  });

  it('refuses a booking with no frozen day rate rather than inventing one', async () => {
    // Every outstation booking made before `perDay` existed. Deriving a price from the total
    // would charge a number nobody ever quoted.
    const stale = runningOutstation();
    const { useCase } = build({
      ...stale,
      fareSnapshot: {
        ...stale.fareSnapshot,
        fare: { ...stale.fareSnapshot.fare, perDay: null },
      },
    });

    await expect(
      useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1' }),
    ).rejects.toThrow(/support/i);
  });

  it('refuses a second request while the first is unanswered', async () => {
    const { useCase } = build(runningOutstation(), [acceptedExtension({ status: 'PENDING' })]);

    await expect(
      useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1' }),
    ).rejects.toThrow(/has not answered/i);
  });

  it('refuses to read somebody else’s booking', async () => {
    const { useCase } = build(runningOutstation());

    await expect(
      useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_someone_else' }),
    ).rejects.toThrow();
  });
});

describe('RespondToExtensionUseCase', () => {
  function build(extensions: BookingExtension[]) {
    const repo = fakeRepo(runningOutstation());
    const rows = fakeExtensions(extensions);
    return {
      rows,
      useCase: new RespondToExtensionUseCase(repo, rows, fakeNotifications()),
    };
  }

  it('accepts, which is what makes the day billable', async () => {
    const { useCase } = build([acceptedExtension({ status: 'PENDING' })]);

    const answered = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      accept: true,
    });

    expect(answered.status).toBe('ACCEPTED');
    expect(answered.respondedAt).not.toBeNull();
  });

  it('declines without charging anything', async () => {
    const { useCase, rows } = build([acceptedExtension({ status: 'PENDING' })]);

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', accept: false });

    expect(totalExtension(rows.all())).toEqual({
      days: 0,
      amountPaise: 0,
      driverAmountPaise: 0,
    });
  });

  it('refuses a request that already lapsed', async () => {
    // The compare-and-swap: expiry is in the filter, so a driver tapping Accept as the sweep
    // fires resolves one way, never both.
    const { useCase } = build([
      acceptedExtension({ status: 'PENDING', expiresAt: new Date(Date.now() - 60_000) }),
    ]);

    await expect(
      useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', accept: true }),
    ).rejects.toThrow(/expired/i);
  });

  it('refuses when there is nothing waiting', async () => {
    const { useCase } = build([]);

    await expect(
      useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', accept: true }),
    ).rejects.toThrow();
  });

  it('refuses a driver who is not on this trip', async () => {
    const { useCase } = build([acceptedExtension({ status: 'PENDING' })]);

    await expect(
      useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_someone_else', accept: true }),
    ).rejects.toThrow();
  });
});

describe('totalExtension', () => {
  it('counts only what the driver agreed to', () => {
    const rows = [
      acceptedExtension({ id: 'ext_1' }),
      acceptedExtension({ id: 'ext_2', status: 'DECLINED' }),
      acceptedExtension({ id: 'ext_3', status: 'EXPIRED' }),
      acceptedExtension({ id: 'ext_4', status: 'PENDING' }),
    ];

    expect(totalExtension(rows)).toEqual({
      days: 1,
      amountPaise: 300_000,
      driverAmountPaise: 225_000,
    });
  });

  it('adds two accepted days together', () => {
    const rows = [acceptedExtension({ id: 'ext_1' }), acceptedExtension({ id: 'ext_2' })];

    expect(totalExtension(rows)).toMatchObject({ days: 2, amountPaise: 600_000 });
  });
});

describe('CompleteTripUseCase — extensions', () => {
  function build(seed: Booking, extensions: BookingExtension[]) {
    const repo = fakeRepo(seed);
    const charges = fakeCharges();
    const ledger = fakeLedger();
    const payments = fakePayments();

    return {
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
        fakeExtensions(extensions),
      ),
    };
  }

  /** A finished outstation trip with no waiting, so the extension is the only extra. */
  const finished = (over: Partial<Booking> = {}) =>
    runningOutstation({
      arrivedAt: new Date('2026-08-31T09:00:00Z'),
      startedAt: new Date('2026-08-31T09:05:00Z'),
      ...over,
    });

  it('bills two accepted days as ONE receipt line', async () => {
    // Forced by the `{ bookingId, type }` unique index, and better anyway: a customer reads one
    // line rather than adding up two identical ones.
    //
    // `paidExtensionPaise` covers both days because on a UPI trip it has to: completion refuses
    // outright while any of an extension is still owed. The receipt line is what is under test,
    // and it is written whatever paid for it.
    const { useCase, charges } = build(finished({ paidExtensionPaise: 600_000 }), [
      acceptedExtension({ id: 'ext_1' }),
      acceptedExtension({ id: 'ext_2' }),
    ]);

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'idem_1' });

    const extension = charges.adjustments().filter((row) => row.type === 'DAY_EXTENSION');
    expect(extension).toHaveLength(1);
    expect(extension[0]?.amountPaise).toBe(600_000);
    expect(extension[0]?.label).toBe('Extended — 2 extra days');
  });

  it('pays the driver their frozen per-day share, commissioned', async () => {
    const { useCase, ledger } = build(finished({ paidExtensionPaise: 300_000 }), [
      acceptedExtension(),
    ]);

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'idem_1' });

    const earning = ledger.entries().find((entry) => entry.entryType === 'EXTENSION_EARNING');
    // The per-day driver amount from the extension row, NOT the whole day's fare — an extra day
    // is a day of the package, unlike the uncommissioned waiting earning.
    expect(earning?.amountPaise).toBe(225_000);
  });

  /*
   * THE GATE. Before it, an extension accepted after the customer had already paid was billed to
   * a receipt line and then collected by a `SETTLEMENT` order the server raised at completion and
   * showed to nobody — no route, no screen, no checkout. The driver ended the trip and the money
   * became a receivable nobody chased. The customer has a Pay button for it now
   * (`PayTripExtrasUseCase`) and this is what makes them use it.
   */
  it('refuses to end a UPI trip with an extra day still unpaid', async () => {
    const { useCase, payments } = build(finished(), [acceptedExtension()]);

    await expect(
      useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'idem_1' }),
    ).rejects.toThrow('still has to pay for the extra day');

    // Nothing was charged and nothing was settled — the trip is still running.
    expect(payments.charge).not.toHaveBeenCalled();
  });

  it('settles the waiting charge alone once the extension has been paid for', async () => {
    // `settle-${bookingId}` is derived from the booking so a retried completion cannot charge
    // twice — which means two separate charges under that key would silently collect only one.
    const { useCase, payments } = build(
      finished({
        paidExtensionPaise: 300_000,
        arrivedAt: new Date('2026-08-31T09:00:00Z'),
        startedAt: new Date('2026-08-31T09:40:00Z'),
      }),
      [acceptedExtension()],
    );

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'idem_1' });

    expect(payments.charge).toHaveBeenCalledTimes(1);
    // 25 chargeable minutes at ₹2 = ₹50. The ₹3,000 day is already collected.
    expect(payments.charge).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaise: 5_000, idempotencyKey: 'settle-bkg_1' }),
    );
  });

  /*
   * The customer already paid for this day at payment selection — `paidExtensionPaise` on the
   * booking. Settling it again here would take ₹3,000 twice for one extra day.
   */
  it('does not re-bill an extension already collected in the payment-selection order', async () => {
    const { useCase, charges, payments } = build(
      finished({
        paidExtensionPaise: 300_000,
        arrivedAt: new Date('2026-08-31T09:00:00Z'),
        startedAt: new Date('2026-08-31T09:40:00Z'),
      }),
      [acceptedExtension()],
    );

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'idem_1' });

    // Waiting only — the ₹3,000 day is already paid for.
    expect(payments.charge).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaise: 5_000, idempotencyKey: 'settle-bkg_1' }),
    );
    // The receipt still shows the whole extension, however it was collected.
    const extension = charges.adjustments().find((row) => row.type === 'DAY_EXTENSION');
    expect(extension?.amountPaise).toBe(300_000);
  });

  /*
   * The order carrying that extension was never paid — they switched to cash instead. Honouring
   * `paidExtensionPaise` here would hand them the extra day for free.
   */
  it('still bills the extension when the booking switched to cash before paying', async () => {
    const { useCase, ledger } = build(
      finished({ paidExtensionPaise: 300_000, paymentMode: 'CASH', paymentStatus: 'CASH' }),
      [acceptedExtension()],
    );

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      idempotencyKey: 'idem_1',
    });

    const fare = finished().fareSnapshot.fare.totalPaise;
    expect(result.totalPaise).toBe(fare + 300_000);
    // The driver takes the extra day at the door along with the fare.
    const collected = ledger.entries().find((entry) => entry.entryType === 'CASH_COLLECTED');
    expect(collected?.amountPaise).toBe(-(fare + 300_000));
  });

  it('counts an already-paid extension in the total the customer has paid', async () => {
    const { useCase } = build(finished({ paidExtensionPaise: 300_000 }), [acceptedExtension()]);

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      idempotencyKey: 'idem_1',
    });

    expect(result.totalPaise).toBe(finished().fareSnapshot.fare.totalPaise + 300_000);
  });

  /*
   * A SECOND DAY BOUGHT AFTER THE FIRST WAS PAID FOR. The gate counts what is OUTSTANDING, not
   * whether anything has been paid at all — a customer who settled day one and not day two is
   * still a customer with an unpaid day, and a `>= 1` test would let it through.
   */
  it('refuses when only part of the extension has been paid for', async () => {
    const { useCase } = build(finished({ paidExtensionPaise: 300_000 }), [
      acceptedExtension({ id: 'ext_1' }),
      acceptedExtension({ id: 'ext_2' }),
    ]);

    await expect(
      useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'idem_1' }),
    ).rejects.toThrow('still has to pay for the extra day');
  });

  /*
   * THE WAY THROUGH THE GATE when the customer's phone is dead — `CollectExtrasInCashUseCase`
   * has recorded the driver taking the day in hand. The company's share of it is in the driver's
   * pocket, so the same negative row a cash FARE gets applies to exactly that portion.
   */
  it('books cash-collected extras against the driver on an otherwise-UPI trip', async () => {
    const { useCase, ledger } = build(
      finished({ paidExtensionPaise: 300_000, cashExtensionPaise: 300_000 }),
      [acceptedExtension()],
    );

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'idem_1' });

    const cash = ledger.entries().find((entry) => entry.entryType === 'CASH_COLLECTED');
    expect(cash?.amountPaise).toBe(-300_000);
  });

  it('charges nothing for days the driver never agreed to', async () => {
    const { useCase, charges, payments } = build(finished(), [
      acceptedExtension({ status: 'DECLINED' }),
      acceptedExtension({ id: 'ext_2', status: 'EXPIRED' }),
    ]);

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'idem_1' });

    expect(charges.adjustments()).toHaveLength(0);
    expect(payments.charge).not.toHaveBeenCalled();
  });

  it('adds the extra day to what a cash driver collects at the door', async () => {
    const { useCase, ledger } = build(
      finished({ paymentMode: 'CASH', paymentId: null }),
      [acceptedExtension()],
    );

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'idem_1' });

    const cash = ledger.entries().find((entry) => entry.entryType === 'CASH_COLLECTED');
    // The frozen fare (₹1,050) plus the extra day (₹3,000). Without this the driver is recorded
    // as holding less than they actually took.
    expect(cash?.amountPaise).toBe(-405_000);
  });
});

describe('SelectPaymentMethodUseCase', () => {
  it('refuses if the booking does not exist or customer does not own it', async () => {
    const repo = fakeRepo(booking({ customerId: 'cus_1' }));
    const payments = fakePayments();
    const useCase = new SelectPaymentMethodUseCase(repo, payments, fakeExtensions());

    await expect(
      useCase.execute({
        bookingId: 'bkg_nonexistent',
        customerId: 'cus_1',
        paymentMode: 'CASH',
        idempotencyKey: 'idem_1',
      }),
    ).rejects.toThrow('That booking does not exist.');

    await expect(
      useCase.execute({
        bookingId: 'bkg_1',
        customerId: 'cus_wrong',
        paymentMode: 'CASH',
        idempotencyKey: 'idem_1',
      }),
    ).rejects.toThrow('That booking does not exist.');
  });

  it('refuses if the trip has not STARTED yet', async () => {
    const repo = fakeRepo(
      booking({ status: 'DRIVER_EN_ROUTE', paymentMode: null, paymentStatus: 'NOT_SELECTED' }),
    );
    const payments = fakePayments();
    const useCase = new SelectPaymentMethodUseCase(repo, payments, fakeExtensions());

    await expect(
      useCase.execute({
        bookingId: 'bkg_1',
        customerId: 'cus_1',
        paymentMode: 'CASH',
        idempotencyKey: 'idem_1',
      }),
    ).rejects.toThrow('You can choose how to pay once your driver has started the trip.');
  });

  /*
   * CASH IS ALWAYS ALLOWED (2026-10-13). The old fee is already on this booking; the driver
   * collects it with the fare and completion marks it collected on the wallet.
   */
  it('allows CASH even when the customer carries an old cancellation fee', async () => {
    const repo = fakeRepo(
      booking({
        status: 'STARTED',
        paymentMode: null,
        paymentStatus: 'NOT_SELECTED',
        walletDebtPaise: 50_000,
      }),
    );
    const payments = fakePayments();
    const useCase = new SelectPaymentMethodUseCase(repo, payments, fakeExtensions());

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      customerId: 'cus_1',
      paymentMode: 'CASH',
      idempotencyKey: 'idem_1',
    });

    expect(result.booking.paymentMode).toBe('CASH');
    expect(result.clientToken).toBeNull();
  });

  it('refuses to change a PREPAID booking — the fare is already paid', async () => {
    const repo = fakeRepo(
      booking({ status: 'STARTED', paymentMode: 'PREPAID', paymentStatus: 'PAID' }),
    );
    const useCase = new SelectPaymentMethodUseCase(repo, fakePayments(), fakeExtensions());

    await expect(
      useCase.execute({
        bookingId: 'bkg_1',
        customerId: 'cus_1',
        paymentMode: 'UPI',
        idempotencyKey: 'idem_1',
      }),
    ).rejects.toThrow('already paid for');
  });

  it('sets paymentMode and paymentStatus to CASH on valid cash selection', async () => {
    const repo = fakeRepo(
      booking({ status: 'STARTED', paymentMode: null, paymentStatus: 'NOT_SELECTED' }),
    );
    const payments = fakePayments();
    const useCase = new SelectPaymentMethodUseCase(repo, payments, fakeExtensions());

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      customerId: 'cus_1',
      paymentMode: 'CASH',
      idempotencyKey: 'idem_1',
    });

    expect(result.booking.paymentMode).toBe('CASH');
    expect(result.booking.paymentStatus).toBe('CASH');
    expect(result.clientToken).toBeNull();
    expect(result.amountPaise).toBeNull();
    expect(repo.setPaymentMode).toHaveBeenCalledWith('bkg_1', 'CASH', 'CASH');
  });

  it('creates an online charge and sets AWAITING_PAYMENT on UPI selection', async () => {
    const repo = fakeRepo(
      booking({
        status: 'STARTED',
        paymentMode: null,
        paymentStatus: 'NOT_SELECTED',
        walletCreditPaise: 5_000,
        walletDebtPaise: 2_000,
      }),
    );
    const payments = fakePayments();
    const useCase = new SelectPaymentMethodUseCase(repo, payments, fakeExtensions());

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      customerId: 'cus_1',
      paymentMode: 'UPI',
      idempotencyKey: 'idem_upi',
    });

    expect(result.booking.paymentMode).toBe('UPI');
    expect(result.booking.paymentStatus).toBe('AWAITING_PAYMENT');
    // 105,000 fare - 5,000 credit + 2,000 debt = 102,000
    expect(payments.charge).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'bkg_1',
        kind: 'BOOKING',
        amountPaise: 102_000,
        idempotencyKey: 'idem_upi',
      }),
    );
    expect(repo.attachPayment).toHaveBeenCalledWith('bkg_1', 'pay_1');
  });

  it('is idempotent when re-selecting the same mode', async () => {
    const repo = fakeRepo(
      booking({ status: 'STARTED', paymentMode: 'CASH', paymentStatus: 'CASH' }),
    );
    const payments = fakePayments();
    const useCase = new SelectPaymentMethodUseCase(repo, payments, fakeExtensions());

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      customerId: 'cus_1',
      paymentMode: 'CASH',
      idempotencyKey: 'idem_retry',
    });

    expect(result.booking.paymentMode).toBe('CASH');
    expect(payments.charge).not.toHaveBeenCalled();
  });

  it('refuses switching when payment is already PAID', async () => {
    const repo = fakeRepo(
      booking({ status: 'STARTED', paymentMode: 'UPI', paymentStatus: 'PAID' }),
    );
    const payments = fakePayments();
    const useCase = new SelectPaymentMethodUseCase(repo, payments, fakeExtensions());

    await expect(
      useCase.execute({
        bookingId: 'bkg_1',
        customerId: 'cus_1',
        paymentMode: 'CASH',
        idempotencyKey: 'idem_switch',
      }),
    ).rejects.toThrow('This trip has already been paid for online.');
  });
});

describe('CompleteTripUseCase — payment gates', () => {
  function build(seed: Booking, paymentsList: Payment[] = []) {
    const repo = fakeRepo(seed);
    const charges = fakeCharges();
    const ledger = fakeLedger();
    const payments = fakePayments();
    payments.listForBooking = vi.fn(async () => paymentsList);

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
        fakeExtensions([]),
      ),
    };
  }

  const liveStarted = (over: Partial<Booking> = {}) =>
    booking({
      status: 'STARTED',
      arrivedAt: new Date('2026-08-31T09:00:00Z'),
      startedAt: new Date('2026-08-31T09:05:00Z'),
      ...over,
    });

  it('refuses completion if paymentMode has not been selected yet', async () => {
    const { useCase } = build(liveStarted({ paymentMode: null, paymentStatus: 'NOT_SELECTED' }));

    await expect(
      useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'idem_1' }),
    ).rejects.toThrow('The customer has not chosen how to pay yet.');
  });

  it('refuses completion if paymentMode is UPI but payment is not captured', async () => {
    const pendingPayment: Payment = {
      id: 'pay_1',
      bookingId: 'bkg_1',
      customerId: 'cus_1',
      kind: 'BOOKING',
      status: 'CREATED',
      amountPaise: 105_000,
      refundedPaise: 0,
      gatewayRef: 'mock_order_1',
      idempotencyKey: 'idem_1',
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { useCase } = build(
      liveStarted({ paymentMode: 'UPI', paymentStatus: 'AWAITING_PAYMENT' }),
      [pendingPayment],
    );

    await expect(
      useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'idem_1' }),
    ).rejects.toThrow("Waiting for the customer's online payment to go through.");
  });

  it('allows completion when paymentMode is UPI and payment is CAPTURED', async () => {
    const capturedPayment: Payment = {
      id: 'pay_1',
      bookingId: 'bkg_1',
      customerId: 'cus_1',
      kind: 'BOOKING',
      status: 'CAPTURED',
      amountPaise: 105_000,
      refundedPaise: 0,
      gatewayRef: 'mock_order_1',
      idempotencyKey: 'idem_1',
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { useCase, ledger } = build(
      liveStarted({ paymentMode: 'UPI', paymentStatus: 'PAID' }),
      [capturedPayment],
    );

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      idempotencyKey: 'idem_1',
    });

    expect(result.booking.status).toBe('COMPLETED');
    const cashCollected = ledger.entries().find((e) => e.entryType === 'CASH_COLLECTED');
    expect(cashCollected).toBeUndefined();
  });

  it('allows completion when paymentMode is CASH and records CASH_COLLECTED', async () => {
    const { useCase, ledger } = build(
      liveStarted({ paymentMode: 'CASH', paymentStatus: 'CASH', paymentId: null }),
      [],
    );

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      idempotencyKey: 'idem_1',
    });

    expect(result.booking.status).toBe('COMPLETED');
    const cashCollected = ledger.entries().find((e) => e.entryType === 'CASH_COLLECTED');
    expect(cashCollected).toBeDefined();
  });
});

describe('ConfirmLatePaymentUseCase', () => {
  it('marks booking as PAID and collects debt into customer wallet', async () => {
    const repo = fakeRepo(
      booking({
        status: 'STARTED',
        paymentMode: 'UPI',
        paymentStatus: 'AWAITING_PAYMENT',
        walletDebtPaise: 40_000,
      }),
    );
    const notifications = fakeNotifications();
    const wallet = fakeWallet();
    const useCase = new ConfirmLatePaymentUseCase(repo, notifications, wallet, fakePayments());

    await useCase.execute('bkg_1');

    expect(repo.setPaymentStatus).toHaveBeenCalledWith('bkg_1', 'PAID');
    expect(wallet.append).toHaveBeenCalledWith([
      expect.objectContaining({
        customerId: 'cus_1',
        bookingId: 'bkg_1',
        entryType: 'DEBT_COLLECTED',
        amountPaise: 40_000,
      }),
    ]);
    expect(notifications.sendBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'CUSTOMER', id: 'cus_1' }),
      expect.objectContaining({ message: expect.stringContaining('Payment received') }),
    );
    expect(notifications.sendBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'DRIVER', id: 'drv_1' }),
      expect.objectContaining({ message: expect.stringContaining('payment has cleared') }),
    );
  });
});

describe('SelectPaymentMethodUseCase — extensions already accepted', () => {
  const startedOutstation = () =>
    runningOutstation({
      paymentMode: null,
      paymentStatus: 'NOT_SELECTED',
      walletCreditPaise: 0,
      walletDebtPaise: 0,
    });

  it('folds an already-accepted extension into the UPI order and records how much', async () => {
    const repo = fakeRepo(startedOutstation());
    const payments = fakePayments();
    const useCase = new SelectPaymentMethodUseCase(
      repo,
      payments,
      fakeExtensions([acceptedExtension({ amountPaise: 300_000 })]),
    );

    await useCase.execute({
      bookingId: 'bkg_1',
      customerId: 'cus_1',
      paymentMode: 'UPI',
      idempotencyKey: 'idem_upi',
    });

    const fare = startedOutstation().fareSnapshot.fare.totalPaise;
    expect(payments.charge).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaise: fare + 300_000 }),
    );
    expect(repo.setPaidExtensionPaise).toHaveBeenCalledWith('bkg_1', 300_000);
  });

  it('ignores an extension the driver has not accepted', async () => {
    const repo = fakeRepo(startedOutstation());
    const payments = fakePayments();
    const useCase = new SelectPaymentMethodUseCase(
      repo,
      payments,
      fakeExtensions([acceptedExtension({ status: 'PENDING' })]),
    );

    await useCase.execute({
      bookingId: 'bkg_1',
      customerId: 'cus_1',
      paymentMode: 'UPI',
      idempotencyKey: 'idem_upi',
    });

    const fare = startedOutstation().fareSnapshot.fare.totalPaise;
    expect(payments.charge).toHaveBeenCalledWith(expect.objectContaining({ amountPaise: fare }));
    expect(repo.setPaidExtensionPaise).not.toHaveBeenCalled();
  });

  /*
   * The whole point of reading the amount off the payment row: an extension accepted between the
   * first attempt and this retry must not change the amount of an order the customer already has.
   */
  it('reopens the original order amount on a retry, not a recomputed one', async () => {
    const repo = fakeRepo(
      runningOutstation({ paymentMode: 'UPI', paymentStatus: 'AWAITING_PAYMENT' }),
    );
    const payments = fakePayments({
      status: 'PENDING',
      amountPaise: 111_000,
      gatewayRef: 'order_original',
    });
    const useCase = new SelectPaymentMethodUseCase(
      repo,
      payments,
      fakeExtensions([acceptedExtension({ amountPaise: 300_000 })]),
    );

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      customerId: 'cus_1',
      paymentMode: 'UPI',
      idempotencyKey: 'idem_retry',
    });

    expect(result.amountPaise).toBe(111_000);
    expect(result.clientToken).toBe('order_original');
    expect(payments.charge).not.toHaveBeenCalled();
  });
});

describe('VerifyPaymentUseCase', () => {
  const awaitingPayment = () =>
    booking({ status: 'STARTED', paymentMode: 'UPI', paymentStatus: 'AWAITING_PAYMENT' });

  function build(seed: Booking) {
    const repo = fakeRepo(seed);
    const payments = fakePayments();
    const notifications = fakeNotifications();
    const confirmLate = new ConfirmLatePaymentUseCase(repo, notifications, fakeWallet(), payments);
    return {
      repo,
      payments,
      notifications,
      useCase: new VerifyPaymentUseCase(repo, payments, confirmLate),
    };
  }

  it('confirms the booking when the signature verifies', async () => {
    const { repo, payments, useCase } = build(awaitingPayment());

    await useCase.execute({
      bookingId: 'bkg_1',
      customerId: 'cus_1',
      providerPaymentId: 'pay_rzp_1',
      signature: 'good_signature',
    });

    expect(payments.verifyAndCapture).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay_1', providerPaymentId: 'pay_rzp_1' }),
    );
    expect(repo.setPaymentStatus).toHaveBeenCalledWith('bkg_1', 'PAID');
  });

  it('refuses an unverified signature and leaves the booking alone', async () => {
    const { repo, payments, useCase } = build(awaitingPayment());
    payments.verifyAndCapture = vi.fn(async () => ({ captured: false }));

    await expect(
      useCase.execute({
        bookingId: 'bkg_1',
        customerId: 'cus_1',
        providerPaymentId: 'pay_rzp_1',
        signature: 'forged',
      }),
    ).rejects.toThrow('Payment could not be verified yet.');

    expect(repo.setPaymentStatus).not.toHaveBeenCalled();
  });

  /* The webhook got there first. Confirming twice would notify twice and re-collect the debt. */
  it('is a no-op once the booking is already PAID', async () => {
    const { repo, payments, useCase } = build(
      booking({ status: 'STARTED', paymentMode: 'UPI', paymentStatus: 'PAID' }),
    );

    await useCase.execute({
      bookingId: 'bkg_1',
      customerId: 'cus_1',
      providerPaymentId: 'pay_rzp_1',
      signature: 'good_signature',
    });

    expect(payments.verifyAndCapture).not.toHaveBeenCalled();
    expect(repo.setPaymentStatus).not.toHaveBeenCalled();
  });

  it('refuses on a cash booking, which has no online payment to verify', async () => {
    const { useCase } = build(
      booking({ status: 'STARTED', paymentMode: 'CASH', paymentStatus: 'CASH' }),
    );

    await expect(
      useCase.execute({
        bookingId: 'bkg_1',
        customerId: 'cus_1',
        providerPaymentId: 'pay_rzp_1',
        signature: 'good_signature',
      }),
    ).rejects.toThrow('There is no online payment on this trip to verify.');
  });
});

describe('DriverSwitchToCashUseCase', () => {
  const stuckOnline = (over: Partial<Booking> = {}) =>
    booking({ status: 'STARTED', paymentMode: 'UPI', paymentStatus: 'AWAITING_PAYMENT', ...over });

  function build(seed: Booking) {
    const repo = fakeRepo(seed);
    const notifications = fakeNotifications();
    return { repo, notifications, useCase: new DriverSwitchToCashUseCase(repo, notifications) };
  }

  it('switches a stuck online payment to cash', async () => {
    const { repo, notifications, useCase } = build(stuckOnline());

    const result = await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1' });

    expect(result.paymentMode).toBe('CASH');
    expect(result.paymentStatus).toBe('CASH');
    expect(repo.setPaymentMode).toHaveBeenCalledWith('bkg_1', 'CASH', 'CASH');
    expect(notifications.sendBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'CUSTOMER' }),
      expect.objectContaining({ message: expect.stringContaining('cash') }),
    );
  });

  it('refuses before the trip is under way', async () => {
    const { useCase } = build(stuckOnline({ status: 'ARRIVED' }));

    await expect(useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1' })).rejects.toThrow(
      'You can only do this while the trip is under way.',
    );
  });

  it('refuses once the customer has already paid online', async () => {
    const { useCase } = build(stuckOnline({ paymentStatus: 'PAID' }));

    await expect(useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1' })).rejects.toThrow(
      'This trip has already been paid for online.',
    );
  });

  /* Cash is always allowed (2026-10-13) — an old fee is collected with the fare, not a blocker. */
  it('switches to cash even while the customer carries an old fee', async () => {
    const { repo, useCase } = build(stuckOnline({ walletDebtPaise: 40_000 }));

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1' });

    expect(repo.setPaymentMode).toHaveBeenCalledWith('bkg_1', 'CASH', 'CASH');
  });

  it('refuses a booking belonging to another driver', async () => {
    const { useCase } = build(stuckOnline({ driverId: 'drv_other' }));

    await expect(useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1' })).rejects.toThrow();
  });
});

describe('DriverPaymentOverrideUseCase', () => {
  const started = (over: Partial<Booking> = {}) =>
    booking({ status: 'STARTED', paymentMode: null, paymentStatus: 'NOT_SELECTED', ...over });

  function build(seed: Booking) {
    const repo = fakeRepo(seed);
    const notifications = fakeNotifications();
    return { repo, notifications, useCase: new DriverPaymentOverrideUseCase(repo, notifications) };
  }

  const run = (
    useCase: DriverPaymentOverrideUseCase,
    over: Partial<Parameters<DriverPaymentOverrideUseCase['execute']>[0]> = {},
  ) =>
    useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      reason: 'CUSTOMER_PHONE_UNAVAILABLE',
      ...over,
    });

  /* The case that had no way through: a web booking, or a phone dead before a method was chosen. */
  it('ends the payment step when the customer never chose a method', async () => {
    const { repo, notifications, useCase } = build(started());

    const result = await run(useCase, { reason: 'WEB_BOOKING' });

    expect(result.paymentMode).toBe('CASH');
    expect(result.paymentStatus).toBe('CASH');
    expect(repo.events()).toEqual([
      expect.objectContaining({
        actorType: 'DRIVER',
        actorId: 'drv_1',
        reason: 'WEB_BOOKING',
        metadata: expect.objectContaining({ paymentOverride: true, previousPaymentMode: null }),
      }),
    ]);
    expect(notifications.sendBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'CUSTOMER' }),
      expect.objectContaining({ message: expect.stringContaining('cash') }),
    );
  });

  it('ends a stuck online payment too', async () => {
    const { useCase } = build(started({ paymentMode: 'UPI', paymentStatus: 'AWAITING_PAYMENT' }));

    const result = await run(useCase, { reason: 'ONLINE_PAYMENT_FAILING' });

    expect(result.paymentMode).toBe('CASH');
  });

  /* Decision: the old fee is collected in the same cash, not left blocking the trip. */
  it('goes through when the customer owes an old cancellation fee, and records it', async () => {
    const { repo, useCase } = build(started({ walletDebtPaise: 40_000 }));

    const result = await run(useCase);

    expect(result.paymentMode).toBe('CASH');
    expect(repo.events()[0]?.metadata).toEqual(expect.objectContaining({ oldFeePaise: 40_000 }));
  });

  it('needs a note when the reason is OTHER', async () => {
    const { repo, useCase } = build(started());

    await expect(run(useCase, { reason: 'OTHER', note: '  ' })).rejects.toThrow('Tell us briefly');
    expect(repo.overridePaymentToCash).not.toHaveBeenCalled();

    const result = await run(useCase, { reason: 'OTHER', note: 'Customer has no smartphone' });
    expect(result.paymentMode).toBe('CASH');
    expect(repo.events()[0]?.metadata).toEqual(
      expect.objectContaining({ note: 'Customer has no smartphone' }),
    );
  });

  it('refuses before the trip is under way', async () => {
    const { useCase } = build(started({ status: 'ARRIVED' }));
    await expect(run(useCase)).rejects.toThrow('You can only do this while the trip is under way.');
  });

  it('refuses once the customer has already paid online', async () => {
    const { useCase } = build(started({ paymentMode: 'UPI', paymentStatus: 'PAID' }));
    await expect(run(useCase)).rejects.toThrow('This trip has already been paid for online.');
  });

  it('refuses a booking belonging to another driver', async () => {
    const { repo, useCase } = build(started({ driverId: 'drv_other' }));
    await expect(run(useCase)).rejects.toThrow();
    expect(repo.overridePaymentToCash).not.toHaveBeenCalled();
  });

  it('says so when the online payment captured in the same instant', async () => {
    const { repo, useCase } = build(
      started({ paymentMode: 'UPI', paymentStatus: 'AWAITING_PAYMENT' }),
    );
    vi.mocked(repo.overridePaymentToCash).mockImplementationOnce(async () => {
      await repo.setPaymentStatus('bkg_1', 'PAID');
      return null;
    });

    await expect(run(useCase)).rejects.toThrow('has just gone through');
  });
});

describe('CompleteTripUseCase — an old cancellation fee taken in cash', () => {
  it('expects the fee in the cash, books it to the driver, and marks it collected', async () => {
    const repo = fakeRepo(
      booking({
        status: 'STARTED',
        paymentMode: 'CASH',
        paymentStatus: 'CASH',
        paymentId: null,
        walletDebtPaise: 40_000,
        arrivedAt: new Date('2026-08-31T09:00:00Z'),
        startedAt: new Date('2026-08-31T09:05:00Z'),
      }),
    );
    const ledger = fakeLedger();
    const wallet = fakeWallet();
    const useCase = new CompleteTripUseCase(
      repo,
      fakeCharges(),
      settings,
      ledger,
      fakePayments(),
      fakeNotifications(),
      fakeExtensions(),
      undefined,
      wallet,
    );

    // No figure reported, so the expected one is used: the fare plus the old fee.
    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'k1' });

    const fare = repo.current().fareSnapshot.fare.totalPaise;
    expect(ledger.entries().find((e) => e.entryType === 'CASH_COLLECTED')?.amountPaise).toBe(
      -(fare + 40_000),
    );
    expect(wallet.rows()).toEqual([
      expect.objectContaining({ entryType: 'DEBT_COLLECTED', amountPaise: 40_000 }),
    ]);
  });
});

describe('ConfirmLatePaymentUseCase — a capture that arrives after the switch to cash', () => {
  it('refunds it rather than collecting twice', async () => {
    const repo = fakeRepo(
      booking({ status: 'STARTED', paymentMode: 'CASH', paymentStatus: 'CASH' }),
    );
    const notifications = fakeNotifications();
    const payments = fakePayments({ status: 'CAPTURED' });
    const useCase = new ConfirmLatePaymentUseCase(repo, notifications, fakeWallet(), payments);

    await useCase.execute('bkg_1');

    expect(payments.refund).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay_1' }));
    expect(repo.setPaymentStatus).not.toHaveBeenCalled();
    expect(notifications.sendBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'CUSTOMER' }),
      expect.objectContaining({ message: expect.stringContaining('refunded') }),
    );
  });

  it('does nothing for a cash booking whose payment never captured', async () => {
    const repo = fakeRepo(
      booking({ status: 'STARTED', paymentMode: 'CASH', paymentStatus: 'CASH' }),
    );
    const payments = fakePayments({ status: 'PENDING' });
    const useCase = new ConfirmLatePaymentUseCase(
      repo,
      fakeNotifications(),
      fakeWallet(),
      payments,
    );

    await useCase.execute('bkg_1');

    expect(payments.refund).not.toHaveBeenCalled();
  });
});

/**
 * COLLECTING A DAY EXTENSION THE BOOKING'S OWN ORDER COULD NOT HAVE COVERED.
 *
 * The gap: a customer pays when the trip starts and buys an extra day that evening. The order
 * carrying the fare was raised, captured and closed hours earlier, and a gateway order cannot be
 * repriced once its id is in a customer's hands — so the extra had nowhere to go. It went to a
 * `SETTLEMENT` order `CompleteTripUseCase` raised at completion and showed to nobody: no route,
 * no screen, no checkout. Billed on the receipt, never collected.
 */
describe('PayTripExtrasUseCase', () => {
  function build(seed: Booking, extensions: BookingExtension[] = []) {
    const repo = fakeRepo(seed);
    const payments = fakePayments({ kind: 'EXTENSION', amountPaise: 300_000 });
    return {
      repo,
      payments,
      useCase: new PayTripExtrasUseCase(repo, payments, fakeExtensions(extensions)),
    };
  }

  it('opens an order for exactly what is still owed on the extension', async () => {
    const { useCase, payments } = build(runningOutstation(), [acceptedExtension()]);

    const order = await useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1' });

    expect(order.amountPaise).toBe(300_000);
    expect(payments.charge).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'EXTENSION', amountPaise: 300_000 }),
    );
  });

  /* Two days agreed, one already in the payment-selection order. Charging the full 2 × ₹3,000
     would take a day the customer has paid for twice. */
  it('deducts what the booking order already carried', async () => {
    const { useCase } = build(runningOutstation({ paidExtensionPaise: 300_000 }), [
      acceptedExtension({ id: 'ext_1' }),
      acceptedExtension({ id: 'ext_2' }),
    ]);

    const order = await useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1' });

    expect(order.amountPaise).toBe(300_000);
  });

  /*
   * KEYED ON THE DAY COUNT. A per-tap key would open a second order for the same day; a key on
   * the booking alone would hand a customer who extended twice the first day's order and collect
   * half of what they owe.
   */
  it('keys the order on how many days have been agreed', async () => {
    const { useCase, payments } = build(runningOutstation(), [
      acceptedExtension({ id: 'ext_1' }),
      acceptedExtension({ id: 'ext_2' }),
    ]);

    await useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1' });

    expect(payments.charge).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'extras-bkg_1-2' }),
    );
  });

  it('refuses when there is nothing outstanding', async () => {
    const { useCase } = build(runningOutstation({ paidExtensionPaise: 300_000 }), [
      acceptedExtension(),
    ]);

    await expect(
      useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1' }),
    ).rejects.toThrow('nothing extra to pay');
  });

  /* Cash settles at the door, and a gateway order here would collect the day a second time. */
  it('refuses on a cash trip rather than opening a second collection', async () => {
    const { useCase, payments } = build(
      runningOutstation({ paymentMode: 'CASH', paymentStatus: 'CASH' }),
      [acceptedExtension()],
    );

    await expect(
      useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1' }),
    ).rejects.toThrow('paid in cash');
    expect(payments.charge).not.toHaveBeenCalled();
  });
});

describe('VerifyExtrasPaymentUseCase', () => {
  function build(seed: Booking, payment: Partial<Payment> = {}) {
    const repo = fakeRepo(seed);
    const payments = fakePayments({ kind: 'EXTENSION', amountPaise: 300_000, ...payment });
    return { repo, payments, useCase: new VerifyExtrasPaymentUseCase(repo, payments) };
  }

  const verify = { providerPaymentId: 'rzp_1', signature: 'sig', paymentId: 'pay_1' };

  it('credits the extension once the capture goes through', async () => {
    const { useCase, repo } = build(runningOutstation());

    await useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1', ...verify });

    expect(repo.current().paidExtensionPaise).toBe(300_000);
  });

  /*
   * THE WEBHOOK IS COMING FOR THE SAME CAPTURE and credits it there. `captured` is true for a row
   * that was ALREADY settled, so crediting on that would count every extension twice — once here
   * and once when the webhook lands. Only `justCaptured` says this call did the work.
   */
  it('credits nothing when the row was already captured', async () => {
    const { useCase, repo, payments } = build(runningOutstation());
    payments.verifyAndCapture = vi.fn(async () => ({ captured: true, justCaptured: false }));

    await useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1', ...verify });

    expect(repo.current().paidExtensionPaise).toBe(0);
  });

  it('refuses a payment that is not an extras order on this booking', async () => {
    const { useCase } = build(runningOutstation(), { kind: 'BOOKING' });

    await expect(
      useCase.execute({ bookingId: 'bkg_1', customerId: 'cus_1', ...verify }),
    ).rejects.toThrow('does not belong to this trip');
  });
});

/**
 * THE DOOR IN THE EXTENSION GATE.
 *
 * `DriverSwitchToCashUseCase` — the usual way out of a payment gate — refuses a booking whose
 * fare has already been paid online, and that is exactly the trip an unpaid extension happens on:
 * they paid this morning, bought a day tonight, and their phone is dead. Without this the driver
 * is stuck on a gate with no door.
 */
describe('CollectExtrasInCashUseCase', () => {
  function build(seed: Booking, extensions: BookingExtension[] = []) {
    const repo = fakeRepo(seed);
    return { repo, useCase: new CollectExtrasInCashUseCase(repo, fakeExtensions(extensions)) };
  }

  it('records the outstanding day as collected, opening the gate', async () => {
    const { useCase, repo } = build(runningOutstation(), [acceptedExtension()]);

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1' });

    expect(repo.current().paidExtensionPaise).toBe(300_000);
    // Tracked separately so the ledger can book the driver as holding the company's share.
    expect(repo.current().cashExtensionPaise).toBe(300_000);
  });

  /* The fare really did go through the gateway. Switching the booking to cash would make
     `ConfirmLatePaymentUseCase` refund it. */
  it('leaves the payment mode alone', async () => {
    const { useCase, repo } = build(runningOutstation(), [acceptedExtension()]);

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1' });

    expect(repo.current().paymentMode).toBe('UPI');
    expect(repo.current().paymentStatus).toBe('PAID');
  });

  it('refuses when nothing is outstanding', async () => {
    const { useCase } = build(runningOutstation({ paidExtensionPaise: 300_000 }), [
      acceptedExtension(),
    ]);

    await expect(
      useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1' }),
    ).rejects.toThrow('nothing outstanding');
  });
});

/*
 * PREPAID AND "CASH IS ALWAYS ALLOWED" (2026-10-13).
 *
 * A prepaid booking's fare reached the company offline, so the driver collects nothing for it —
 * but waiting and an extra day were never part of what was prepaid. At the end the driver says how
 * those were settled: cash, online (UPI trips only), or left unpaid as the customer's dues. Every
 * one of those ends the trip.
 */
describe('CompleteTripUseCase — settling the extras (cash / online / unpaid)', () => {
  // Arrived 09:00, started 09:40 — well past the free window, so there is a waiting charge.
  const waited = {
    arrivedAt: new Date('2026-08-31T09:00:00Z'),
    startedAt: new Date('2026-08-31T09:40:00Z'),
  };

  function build(seed: Booking, extensions: BookingExtension[] = []) {
    const repo = fakeRepo(seed);
    const ledger = fakeLedger();
    const wallet = fakeWallet();
    const payments = fakePayments();
    return {
      repo,
      ledger,
      wallet,
      payments,
      useCase: new CompleteTripUseCase(
        repo,
        fakeCharges(),
        settings,
        ledger,
        payments,
        fakeNotifications(),
        fakeExtensions(extensions),
        undefined,
        wallet,
      ),
    };
  }

  const prepaid = (over: Partial<Booking> = {}) =>
    booking({
      status: 'STARTED',
      paymentMode: 'PREPAID',
      paymentStatus: 'PAID',
      paymentId: null,
      ...waited,
      ...over,
    });

  it('prepaid, extras in cash: the driver holds only the extras, nothing for the fare', async () => {
    const { useCase, ledger, payments, repo } = build(prepaid());

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      extrasCollection: 'CASH',
      idempotencyKey: 'k1',
    });

    expect(result.waitingChargePaise).toBeGreaterThan(0);
    const cash = ledger.entries().filter((e) => e.entryType === 'CASH_COLLECTED');
    expect(cash).toEqual([expect.objectContaining({ amountPaise: -result.waitingChargePaise })]);
    expect(ledger.entries().some((e) => e.entryType === 'TRIP_EARNING')).toBe(true);
    expect(payments.charge).not.toHaveBeenCalled();
    expect(repo.current().extrasCollection).toBe('CASH');
  });

  it('prepaid, nothing said (older driver app): extras become the customer’s dues', async () => {
    const { useCase, ledger, wallet } = build(prepaid());

    const result = await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'k1' });

    expect(ledger.entries().some((e) => e.entryType === 'CASH_COLLECTED')).toBe(false);
    expect(wallet.rows()).toEqual([
      expect.objectContaining({
        entryType: 'UNPAID_TRIP_CHARGE',
        amountPaise: -result.waitingChargePaise,
      }),
    ]);
  });

  it('prepaid with no extras: ends cleanly and records no settlement', async () => {
    const { useCase, ledger, wallet, repo } = build(
      prepaid({ arrivedAt: new Date('2026-08-31T09:00:00Z'), startedAt: new Date('2026-08-31T09:02:00Z') }),
    );

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', idempotencyKey: 'k1' });

    expect(repo.current().status).toBe('COMPLETED');
    expect(repo.current().extrasCollection).toBeNull();
    expect(ledger.entries().some((e) => e.entryType === 'CASH_COLLECTED')).toBe(false);
    expect(wallet.rows()).toHaveLength(0);
  });

  it('refuses ONLINE settlement on a trip that has no online order', async () => {
    const { useCase } = build(prepaid());

    await expect(
      useCase.execute({
        bookingId: 'bkg_1',
        driverId: 'drv_1',
        extrasCollection: 'ONLINE',
        idempotencyKey: 'k1',
      }),
    ).rejects.toThrow('only for trips paid online');
  });

  it('UPI trip with an unpaid extra day: cash is accepted instead of blocking the trip', async () => {
    const { useCase, ledger, payments, repo } = build(
      runningOutstation({ arrivedAt: new Date('2026-08-31T09:00:00Z'), startedAt: new Date('2026-08-31T09:02:00Z') }),
      [acceptedExtension()],
    );

    await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      extrasCollection: 'CASH',
      idempotencyKey: 'k1',
    });

    expect(repo.current().status).toBe('COMPLETED');
    expect(payments.charge).not.toHaveBeenCalled();
    expect(ledger.entries().filter((e) => e.entryType === 'CASH_COLLECTED')).toEqual([
      expect.objectContaining({ amountPaise: -300_000 }),
    ]);
  });

  it('cash trip with the extras left unpaid: the driver is booked for the fare only', async () => {
    const { useCase, ledger, wallet, repo } = build(
      booking({ status: 'STARTED', paymentMode: 'CASH', paymentStatus: 'CASH', paymentId: null, ...waited }),
    );

    const result = await useCase.execute({
      bookingId: 'bkg_1',
      driverId: 'drv_1',
      extrasCollection: 'UNPAID',
      idempotencyKey: 'k1',
    });

    const fare = repo.current().fareSnapshot.fare.totalPaise;
    expect(ledger.entries().find((e) => e.entryType === 'CASH_COLLECTED')?.amountPaise).toBe(-fare);
    expect(wallet.rows()).toEqual([
      expect.objectContaining({ entryType: 'UNPAID_TRIP_CHARGE', amountPaise: -result.waitingChargePaise }),
    ]);
  });
});

describe('StartTripUseCase — the waiting charge is known from the start', () => {
  it('records the waiting charge on the booking when the trip starts', async () => {
    const repo = fakeRepo(
      booking({ status: 'ARRIVED', arrivedAt: new Date(Date.now() - 60 * 60_000) }),
    );
    const useCase = new StartTripUseCase(repo, settings, fakeNotifications());

    await useCase.execute({ bookingId: 'bkg_1', driverId: 'drv_1', otp: '4821' });

    expect(repo.current().waitingChargePaise).toBeGreaterThan(0);
    expect(repo.current().waitingMinutes).toBeGreaterThanOrEqual(59);
  });
});

describe('Cancelling a PREPAID booking', () => {
  it('records the offline refund an admin has to send', async () => {
    const repo = fakeRepo(
      booking({ status: 'ASSIGNED', paymentMode: 'PREPAID', paymentStatus: 'PAID', paymentId: null }),
    );
    const payments = fakePayments();
    const useCase = new CancelBookingByAdminUseCase(repo, payments, fakeNotifications());

    const result = await useCase.execute({ bookingId: 'bkg_1', actorId: 'adm_1', reason: 'Customer called to cancel' });

    expect(result.refundedPaise).toBe(0);
    expect(payments.refund).not.toHaveBeenCalled();
    expect(repo.events().at(-1)?.metadata).toEqual(
      expect.objectContaining({ manualRefundPaise: repo.current().fareSnapshot.fare.totalPaise }),
    );
  });
});

describe("GET /driver/bookings — the customer's name, never their number", () => {
  async function listWith(contacts: Map<string, CustomerContact>) {
    const repo = {
      listForDriver: vi.fn(async () => [booking({ status: 'COMPLETED', customerId: 'cus_1' })]),
    };
    const directory = {
      namesByIds: vi.fn(async () => new Map([['cus_1', '+919000000002']])), // the phone fallback
      customerContactsByIds: vi.fn(async () => contacts),
    };
    const handler = makeListDriverTripsController(
      repo as unknown as BookingRepositoryPort,
      { listAdjustments: vi.fn(async () => []) } as unknown as ChargeRepositoryPort,
      directory as unknown as Parameters<typeof makeListDriverTripsController>[2],
    );

    let body: { data: ListDriverTripsResponse } | undefined;
    const req = { query: {}, principal: { sub: 'drv_1' }, method: 'GET', originalUrl: '/' } as unknown as Request;
    const res = {
      status: () => res,
      json: (b: { data: ListDriverTripsResponse }) => {
        body = b;
      },
    } as unknown as Response;
    await new Promise<void>((resolve) => {
      handler(req, res, () => resolve());
      setTimeout(resolve, 20);
    });
    return body?.data.bookings[0];
  }

  it('shows no name — not the phone number — for a customer who never set one', async () => {
    const trip = await listWith(
      new Map([['cus_1', { id: 'cus_1', fullName: null, phone: '+919000000002' }]]),
    );

    // The app renders "Customer" for a null name. What it must never get is the number: the list is
    // full of finished trips, and a finished trip does not carry one.
    expect(trip?.customer?.name).toBeNull();
    expect(JSON.stringify(trip)).not.toContain('9000000002');
  });

  it('shows the name when the customer has one, and still no number', async () => {
    const trip = await listWith(
      new Map([['cus_1', { id: 'cus_1', fullName: 'Anita Rai', phone: '+919000000002' }]]),
    );

    expect(trip?.customer?.name).toBe('Anita Rai');
    expect(trip?.customer?.phone).toBeNull();
  });
});
