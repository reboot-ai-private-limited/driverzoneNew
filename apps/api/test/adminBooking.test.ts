import { describe, expect, it, vi } from 'vitest';
import type { BookingStatus } from '@driverzone/contracts';
import { CreateBookingUseCase } from '../src/modules/bookings/application/useCases/createBooking.usecase.js';
import type { Booking } from '../src/modules/bookings/domain/booking.entity.js';
import type {
  BookingRepositoryPort,
  NewBooking,
} from '../src/modules/bookings/domain/bookingRepository.port.js';
import type { Quote } from '../src/modules/quotes/domain/quote.entity.js';
import type { QuoteConsumptionContract } from '../src/modules/quotes/quotes.public.js';
import type { SettingsReadContract } from '../src/modules/settings/settings.public.js';
import type { WalletPublicContract } from '../src/modules/wallet/wallet.public.js';
import { RunDispatchWaveUseCase } from '../src/modules/dispatch/application/useCases/runWave.usecase.js';

/**
 * ADMIN BOOKING — a trip booked from the panel on a customer's behalf.
 *
 * The property that matters is the one nobody would see go wrong: a MANUAL booking must never be
 * rung for. Two doors lead to a ring — the dispatch job `createBooking` enqueues, and a wave job
 * that reaches `RunDispatchWaveUseCase` anyway — and both are pinned here.
 */

const fare = {
  lines: [{ code: 'BASE', label: 'Base fare', amountPaise: 50_000 }],
  subtotalPaise: 50_000,
  taxPaise: 0,
  totalPaise: 50_000,
};

function quote(over: Partial<Quote> = {}): Quote {
  return {
    id: 'qot_1',
    customerId: 'cus_1',
    serviceType: 'INCITY',
    pickup: { lat: 26.7271, lng: 88.3953 },
    drop: { lat: 26.73, lng: 88.4 },
    scheduledAt: new Date(Date.now() - 1_000),
    direction: null,
    returnAt: null,
    distanceKm: null,
    includedMinutes: 180,
    source: {
      packageId: 'pkg_1',
      packageName: 'Incity',
      variantId: 'var_1',
      variantLabel: '3 Hours',
      pickupZoneId: 'zon_1',
      pickupZoneName: 'Siliguri',
      cityZoneId: 'zon_1',
      cityName: 'Siliguri',
      terrain: null,
    },
    fare: fare as unknown as Quote['fare'],
    expiresAt: new Date(Date.now() + 600_000),
    consumedBy: null,
    createdAt: new Date(),
    ...over,
  };
}

function fakeRepo() {
  let current: Booking | null = null;
  const created: NewBooking[] = [];
  const transitions: Array<{ to: BookingStatus; actor: { type: string; id: string | null } }> = [];

  const repo = {
    created: () => created,
    transitions: () => transitions,
    create: vi.fn(async (data: NewBooking) => {
      created.push(data);
      const { createdBy: _createdBy, startOtp: _otp, ...fields } = data;
      current = {
        ...fields,
        id: 'bkg_1',
        driverId: null,
        status: 'PENDING_PAYMENT',
        paymentStatus: 'NOT_SELECTED',
        paymentId: null,
        paidExtensionPaise: 0,
        cashExtensionPaise: 0,
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
      } as Booking;
      return current;
    }),
    findById: vi.fn(async () => current),
    transition: vi.fn(async (input: { to: BookingStatus; actor: { type: string; id: string | null } }) => {
      if (current === null) return null;
      transitions.push({ to: input.to, actor: input.actor });
      current = { ...current, status: input.to };
      return current;
    }),
  };
  return repo as unknown as BookingRepositoryPort & typeof repo;
}

function build() {
  const repo = fakeRepo();
  const quotes: QuoteConsumptionContract = {
    findById: vi.fn(async () => quote()),
    consume: vi.fn(async () => ({ claimed: true, quote: quote() })),
  } as unknown as QuoteConsumptionContract;
  const settings = {
    snapshot: vi.fn(async () => ({ 'dispatch.scheduled_lead_minutes': 90 })),
  } as unknown as SettingsReadContract;
  const wallet = {
    planFor: vi.fn(async () => ({ creditAppliedPaise: 0, debtAddedPaise: 0 })),
    append: vi.fn(async () => []),
  } as unknown as WalletPublicContract;
  const scheduleDispatch = vi.fn(async () => undefined);

  return {
    repo,
    scheduleDispatch,
    useCase: new CreateBookingUseCase(repo, quotes, settings, wallet, scheduleDispatch),
  };
}

const input = {
  customerId: 'cus_1',
  quoteId: 'qot_1',
  pickupAddress: 'Hakimpara',
  dropAddress: 'Sevoke Road',
  carCategory: 'SEDAN' as const,
  vehicleType: 'MANUAL' as const,
  preferFavouriteDrivers: false,
  idempotencyKey: 'key_1',
};

describe('CreateBookingUseCase — admin booking (manual dispatch)', () => {
  it('confirms the booking but enqueues no dispatch', async () => {
    const { useCase, scheduleDispatch } = build();

    const result = await useCase.execute({
      ...input,
      dispatchMode: 'MANUAL',
      createdBy: { type: 'ADMIN', id: 'adm_1' },
    });

    expect(result.booking.status).toBe('CONFIRMED');
    expect(result.booking.dispatchMode).toBe('MANUAL');
    expect(scheduleDispatch).not.toHaveBeenCalled();
  });

  it('records the admin, not the customer, as who made it', async () => {
    const { useCase, repo } = build();

    await useCase.execute({
      ...input,
      dispatchMode: 'MANUAL',
      createdBy: { type: 'ADMIN', id: 'adm_1' },
    });

    expect(repo.created()[0]?.createdBy).toEqual({ type: 'ADMIN', id: 'adm_1' });
    expect(repo.transitions()[0]).toEqual({
      to: 'CONFIRMED',
      actor: { type: 'ADMIN', id: 'adm_1' },
    });
  });

  it('still books for the customer — the booking is theirs, not the admin’s', async () => {
    const { useCase, repo } = build();

    await useCase.execute({ ...input, dispatchMode: 'MANUAL', createdBy: { type: 'ADMIN', id: 'adm_1' } });

    expect(repo.created()[0]?.customerId).toBe('cus_1');
  });

  it('refuses a quote that belongs to a different customer', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({
        ...input,
        customerId: 'cus_2',
        dispatchMode: 'MANUAL',
        createdBy: { type: 'ADMIN', id: 'adm_1' },
      }),
    ).rejects.toThrow(/no longer exists/);
  });

  it('leaves an ordinary customer booking exactly as it was — AUTO, dispatched, customer-made', async () => {
    const { useCase, scheduleDispatch, repo } = build();

    const result = await useCase.execute(input);

    expect(result.booking.dispatchMode).toBe('AUTO');
    expect(scheduleDispatch).toHaveBeenCalledTimes(1);
    expect(repo.created()[0]?.createdBy).toEqual({ type: 'CUSTOMER', id: 'cus_1' });
    expect(repo.transitions()[0]?.actor).toEqual({ type: 'SYSTEM', id: null });
  });
});

describe('RunDispatchWaveUseCase — a manual booking is never rung', () => {
  it('returns without moving the booking or ringing anybody', async () => {
    const booking = { id: 'bkg_1', status: 'CONFIRMED', dispatchMode: 'MANUAL' } as Booking;
    const bookings = {
      findById: vi.fn(async () => booking),
      beginSearching: vi.fn(async () => null),
    };
    const pool = { findEligible: vi.fn(async () => []) };
    const offers = { driverIdsOffered: vi.fn(async () => []) };

    const useCase = new RunDispatchWaveUseCase(
      offers as never,
      pool as never,
      bookings as never,
      { snapshot: vi.fn() } as never,
      {} as never,
      async () => undefined,
      {} as never,
    );

    const outcome = await useCase.execute('bkg_1');

    expect(outcome).toEqual({ rang: false, reason: 'NOT_SEARCHING' });
    expect(bookings.beginSearching).not.toHaveBeenCalled();
    expect(pool.findEligible).not.toHaveBeenCalled();
  });
});
