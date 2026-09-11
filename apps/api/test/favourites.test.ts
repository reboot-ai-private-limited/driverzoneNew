import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManageFavouritesUseCase } from '../src/modules/favourites/application/useCases/manageFavourites.usecase.js';
import {
  MAX_FAVOURITES,
  type FavouriteDriver,
} from '../src/modules/favourites/domain/favourite.entity.js';
import type { FavouriteRepositoryPort } from '../src/modules/favourites/domain/favouriteRepository.port.js';
import type { BookingFavouritesContract } from '../src/modules/bookings/bookings.public.js';
import type { DriverCard, DriverCardContract } from '../src/modules/identity/identity.public.js';
import { AppError } from '../src/shared/errors/AppError.js';

/**
 * An in-memory stand-in for the collection, unique pair index and all. `add` reports `added:
 * false` on a repeat exactly as the real one does when Mongo raises a duplicate key.
 */
function fakeRepo(seed: FavouriteDriver[] = []) {
  const rows = [...seed];

  const repo: FavouriteRepositoryPort & { all: () => FavouriteDriver[] } = {
    all: () => rows,

    add: vi.fn(async (customerId: string, driverId: string) => {
      if (rows.some((r) => r.customerId === customerId && r.driverId === driverId)) {
        return { added: false };
      }
      rows.unshift({ customerId, driverId, createdAt: new Date() });
      return { added: true };
    }),

    remove: vi.fn(async (customerId: string, driverId: string) => {
      const at = rows.findIndex((r) => r.customerId === customerId && r.driverId === driverId);
      if (at >= 0) rows.splice(at, 1);
    }),

    listForCustomer: vi.fn(async (customerId: string) =>
      rows.filter((r) => r.customerId === customerId),
    ),

    countForCustomer: vi.fn(
      async (customerId: string) => rows.filter((r) => r.customerId === customerId).length,
    ),
  };

  return repo;
}

const card = (id: string, over: Partial<DriverCard> = {}): DriverCard => ({
  id,
  fullName: 'Ramesh Chettri',
  // Returned unconditionally by the real contract. Whether it reaches a customer is the caller's
  // decision, which is precisely what the list test below asserts.
  phone: '+919800000000',
  photoUrl: 'https://cdn.example/ramesh.jpg',
  rating: 4.7,
  ratingCount: 31,
  ...over,
});

function fakeDrivers(known: DriverCard[]): DriverCardContract {
  return {
    driverCardsByIds: vi.fn(
      async (ids: string[]) => new Map(known.filter((c) => ids.includes(c.id)).map((c) => [c.id, c])),
    ),
  };
}

const rode = (answer: boolean): BookingFavouritesContract => ({
  hasCompletedTripTogether: vi.fn(async () => answer),
});

const favourite = (driverId: string, customerId = 'cus_1'): FavouriteDriver => ({
  customerId,
  driverId,
  createdAt: new Date(),
});

describe('ManageFavouritesUseCase — adding', () => {
  let repo: ReturnType<typeof fakeRepo>;

  beforeEach(() => {
    repo = fakeRepo();
  });

  it('adds a driver the customer has completed a trip with', async () => {
    const useCase = new ManageFavouritesUseCase(repo, rode(true), fakeDrivers([card('drv_1')]));

    await useCase.add('cus_1', 'drv_1');

    expect(repo.all().map((r) => r.driverId)).toEqual(['drv_1']);
  });

  it('refuses a driver the customer has never ridden with', async () => {
    const useCase = new ManageFavouritesUseCase(repo, rode(false), fakeDrivers([card('drv_1')]));

    await expect(useCase.add('cus_1', 'drv_1')).rejects.toBeInstanceOf(AppError);
    expect(repo.all()).toHaveLength(0);
  });

  it('does not confirm that an unknown driver id exists', async () => {
    /*
     * The point of the ordering in the use case. Probing a driver id must not distinguish "no
     * such driver" from "you have never ridden with them" — otherwise this endpoint enumerates
     * the driver collection for anyone holding a customer token.
     */
    const drivers = fakeDrivers([]);
    const useCase = new ManageFavouritesUseCase(repo, rode(false), drivers);

    await expect(useCase.add('cus_1', 'drv_unknown')).rejects.toMatchObject({ statusCode: 404 });
    expect(drivers.driverCardsByIds).not.toHaveBeenCalled();
  });

  it('is idempotent — a double tap of the heart is not an error', async () => {
    const useCase = new ManageFavouritesUseCase(repo, rode(true), fakeDrivers([card('drv_1')]));

    await useCase.add('cus_1', 'drv_1');
    await useCase.add('cus_1', 'drv_1');

    expect(repo.all()).toHaveLength(1);
  });

  it('refuses to go past the cap, and says what the cap is', async () => {
    const full = fakeRepo(
      Array.from({ length: MAX_FAVOURITES }, (_, i) => favourite(`drv_existing_${i}`)),
    );
    const useCase = new ManageFavouritesUseCase(full, rode(true), fakeDrivers([card('drv_new')]));

    await expect(useCase.add('cus_1', 'drv_new')).rejects.toThrow(String(MAX_FAVOURITES));
    expect(full.all()).toHaveLength(MAX_FAVOURITES);
  });
});

describe('ManageFavouritesUseCase — listing', () => {
  it('never passes the driver phone number through', async () => {
    // `DriverCardContract` returns it unconditionally and leaves the decision to the caller. A
    // favourites list is not a live trip: there is nobody at a kerb to reach.
    const repo = fakeRepo([favourite('drv_1')]);
    const useCase = new ManageFavouritesUseCase(repo, rode(true), fakeDrivers([card('drv_1')]));

    const { favourites } = await useCase.list('cus_1');

    expect(favourites).toHaveLength(1);
    expect(JSON.stringify(favourites)).not.toContain('9800000000');
  });

  it('drops a favourite whose driver no longer exists rather than rendering a blank row', async () => {
    const repo = fakeRepo([favourite('drv_1'), favourite('drv_deleted')]);
    const useCase = new ManageFavouritesUseCase(repo, rode(true), fakeDrivers([card('drv_1')]));

    const { favourites, max } = await useCase.list('cus_1');

    expect(favourites.map((f) => f.id)).toEqual(['drv_1']);
    expect(max).toBe(MAX_FAVOURITES);
  });

  it('does not look a driver up at all for a customer with no favourites', async () => {
    const drivers = fakeDrivers([]);
    const useCase = new ManageFavouritesUseCase(fakeRepo(), rode(true), drivers);

    await expect(useCase.list('cus_1')).resolves.toEqual({ favourites: [], max: MAX_FAVOURITES });
    expect(drivers.driverCardsByIds).not.toHaveBeenCalled();
  });
});

describe('ManageFavouritesUseCase — removing', () => {
  it('is idempotent — removing one that is not there still leaves it not there', async () => {
    const repo = fakeRepo([favourite('drv_1')]);
    const useCase = new ManageFavouritesUseCase(repo, rode(true), fakeDrivers([card('drv_1')]));

    await useCase.remove('cus_1', 'drv_1');
    await useCase.remove('cus_1', 'drv_1');

    expect(repo.all()).toHaveLength(0);
  });
});
