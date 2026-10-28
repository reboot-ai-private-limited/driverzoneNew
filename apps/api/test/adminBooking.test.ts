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
import { createBookingSchema } from '../src/modules/bookings/interface/bookings.validation.js';

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

type SavedCar = { id: string; plateNumber: string; isDefault: boolean };

function build(options: { cars?: SavedCar[]; requirePlate?: boolean } = {}) {
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
  const vehicles = {
    vehiclesForBooking: vi.fn(async () => options.cars ?? []),
    upsertVehicleFromBooking: vi.fn(async () => 'veh_new'),
  };

  return {
    repo,
    scheduleDispatch,
    vehicles,
    useCase: new CreateBookingUseCase(
      repo,
      quotes,
      settings,
      wallet,
      scheduleDispatch,
      vehicles,
      options.requirePlate ?? false,
    ),
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

describe('CreateBookingUseCase — the admin sets the payment mode', () => {
  const admin = { dispatchMode: 'MANUAL' as const, createdBy: { type: 'ADMIN' as const, id: 'adm_1' } };

  it('a PREPAID booking starts paid, with its reference, and leaves the wallet alone', async () => {
    const { useCase, repo } = build();
    const wallet = (useCase as unknown as { wallet: WalletPublicContract }).wallet;

    await useCase.execute({
      ...input,
      ...admin,
      presetPayment: { mode: 'PREPAID', reference: 'UTR 4455' },
    });

    expect(repo.created()[0]).toMatchObject({
      paymentMode: 'PREPAID',
      paymentStatus: 'PAID',
      paymentReference: 'UTR 4455',
      walletCreditPaise: 0,
      walletDebtPaise: 0,
    });
    expect(wallet.planFor).not.toHaveBeenCalled();
  });

  it('a CASH booking starts as cash', async () => {
    const { useCase, repo } = build();

    await useCase.execute({ ...input, ...admin, presetPayment: { mode: 'CASH', reference: null } });

    expect(repo.created()[0]).toMatchObject({ paymentMode: 'CASH', paymentStatus: 'CASH' });
  });

  it('a customer booking still leaves the mode for later', async () => {
    const { useCase, repo } = build();

    await useCase.execute(input);

    expect(repo.created()[0]?.paymentMode).toBeNull();
    expect(repo.created()[0]?.paymentStatus).toBeUndefined();
  });
});

describe('CreateBookingUseCase — the car number on the booking', () => {
  const cars: SavedCar[] = [
    { id: 'veh_1', plateNumber: 'WB74AB1234', isDefault: false },
    { id: 'veh_2', plateNumber: 'WB74CD5678', isDefault: true },
  ];

  it('copies the chosen saved car onto the booking', async () => {
    const { useCase, repo } = build({ cars });
    await useCase.execute({ ...input, vehicleId: 'veh_1' });
    expect(repo.created()[0]?.plateNumber).toBe('WB74AB1234');
  });

  it('refuses a car id that is not on the customer’s profile', async () => {
    const { useCase } = build({ cars });
    await expect(useCase.execute({ ...input, vehicleId: 'veh_other' })).rejects.toThrow(
      /not saved on your profile/,
    );
  });

  it('records a typed plate, uppercased, and saves it to the profile', async () => {
    const { useCase, repo, vehicles } = build();
    await useCase.execute({ ...input, plateNumber: ' wb74ef9012 ' });
    expect(repo.created()[0]?.plateNumber).toBe('WB74EF9012');
    expect(vehicles.upsertVehicleFromBooking).toHaveBeenCalledWith('cus_1', {
      category: 'SEDAN',
      plateNumber: 'WB74EF9012',
    });
  });

  it('falls back to the default car when none is named — the older app’s path', async () => {
    const { useCase, repo } = build({ cars });
    await useCase.execute(input);
    expect(repo.created()[0]?.plateNumber).toBe('WB74CD5678');
  });

  it('books with no plate while the rule is off', async () => {
    const { useCase, repo } = build();
    await useCase.execute(input);
    expect(repo.created()[0]?.plateNumber).toBeNull();
  });

  it('refuses a customer with no car once the rule is on', async () => {
    const { useCase, repo } = build({ requirePlate: true });
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'VEHICLE_REQUIRED' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('never refuses an admin booking for a missing car, even with the rule on', async () => {
    const { useCase, repo } = build({ requirePlate: true });
    await useCase.execute({
      ...input,
      dispatchMode: 'MANUAL',
      createdBy: { type: 'ADMIN', id: 'adm_1' },
    });
    expect(repo.created()[0]?.plateNumber).toBeNull();
  });
});

describe('CreateBookingUseCase — booking for someone else', () => {
  it('records the passenger on the booking, trimmed', async () => {
    const { useCase, repo } = build();
    await useCase.execute({ ...input, rider: { name: '  Ramesh Das ', phone: ' +919811111111 ' } });
    expect(repo.created()[0]?.rider).toEqual({ name: 'Ramesh Das', phone: '+919811111111' });
  });

  it('records no passenger when none is given — the customer is travelling, as every older app means', async () => {
    const { useCase, repo } = build();
    await useCase.execute(input);
    expect(repo.created()[0]?.rider).toBeNull();
  });

  it('lets an admin booking carry a passenger too', async () => {
    const { useCase, repo } = build();
    await useCase.execute({
      ...input,
      rider: { name: 'Ramesh Das', phone: '+919811111111' },
      dispatchMode: 'MANUAL',
      createdBy: { type: 'ADMIN', id: 'adm_1' },
    });
    expect(repo.created()[0]?.rider?.name).toBe('Ramesh Das');
  });
});

describe('createBookingSchema — the passenger', () => {
  const body = {
    quoteId: 'q_1',
    pickupAddress: 'Siliguri',
    dropAddress: 'Darjeeling',
    carCategory: 'SEDAN',
    vehicleType: 'MANUAL',
  };

  it('accepts a booking with no passenger — the request every older app sends', () => {
    expect(createBookingSchema.parse(body).rider).toBeUndefined();
  });

  it('accepts a passenger with an E.164 number', () => {
    const parsed = createBookingSchema.parse({ ...body, rider: { name: 'Ramesh', phone: '+919811111111' } });
    expect(parsed.rider).toEqual({ name: 'Ramesh', phone: '+919811111111' });
  });

  it.each([
    ['a bare national number', { name: 'Ramesh', phone: '9811111111' }],
    ['an empty name', { name: '   ', phone: '+919811111111' }],
    ['a missing number', { name: 'Ramesh' }],
    ['an unknown field', { name: 'Ramesh', phone: '+919811111111', email: 'r@example.com' }],
  ])('refuses %s', (_label, rider) => {
    expect(createBookingSchema.safeParse({ ...body, rider }).success).toBe(false);
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
