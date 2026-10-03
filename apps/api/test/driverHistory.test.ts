import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { ListDriverTripsResponse } from '@driverzone/contracts';
import { makeListDriverTripsController } from '../src/modules/bookings/interface/bookings.controller.js';
import { encodeHistoryCursor } from '../src/modules/bookings/interface/bookings.validation.js';
import type { BookingRepositoryPort } from '../src/modules/bookings/domain/bookingRepository.port.js';
import type { ChargeRepositoryPort } from '../src/modules/bookings/domain/chargeRepository.port.js';

/**
 * `GET /driver/bookings` — the paged trip list and the unpaged read Home and older builds make.
 * The query itself is pinned against a real Mongo in `integration/driverHistory`.
 */

function harness() {
  const repo = {
    listForDriver: vi.fn(async () => []),
    pageForDriver: vi.fn(async () => ({ bookings: [], nextCursor: { key: 1_700_000_000_000, id: 'b_20' } })),
    driverHistorySummary: vi.fn(async () => ({ totalTrips: 12, completedTrips: 9, faresPaise: 450_000 })),
  };
  const directory = {
    namesByIds: vi.fn(async () => new Map()),
    idsMatching: vi.fn(async () => ['cus_9']),
  };
  const handler = makeListDriverTripsController(
    repo as unknown as BookingRepositoryPort,
    { listAdjustments: vi.fn(async () => []) } as unknown as ChargeRepositoryPort,
    directory as unknown as Parameters<typeof makeListDriverTripsController>[2],
  );

  async function call(query: Record<string, string>) {
    let body: { data: ListDriverTripsResponse } | undefined;
    let error: unknown;
    const req = { query, principal: { sub: 'drv_1' }, method: 'GET', originalUrl: '/' } as unknown as Request;
    const res = {
      status: () => res,
      json: (b: { data: ListDriverTripsResponse }) => {
        body = b;
      },
    } as unknown as Response;
    await new Promise<void>((resolve) => {
      handler(req, res, (err?: unknown) => {
        error = err;
        resolve();
      });
      setTimeout(resolve, 20);
    });
    return { data: body?.data, error };
  }

  return { repo, directory, call };
}

describe('GET /driver/bookings', () => {
  it('without `limit` is the old capped read: no cursor, no summary', async () => {
    const { repo, call } = harness();
    const { data } = await call({});

    expect(repo.listForDriver).toHaveBeenCalledWith('drv_1', 100);
    expect(repo.pageForDriver).not.toHaveBeenCalled();
    expect(data).toEqual({ bookings: [], next_cursor: null, summary: null });
  });

  it('a first page carries the summary and an opaque cursor', async () => {
    const { repo, call } = harness();
    const { data } = await call({ limit: '20', group: 'COMPLETED' });

    expect(repo.pageForDriver).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'drv_1', limit: 20, group: 'COMPLETED', cursor: undefined }),
    );
    expect(data?.summary).toEqual({
      total_trips: 12,
      completed_trips: 9,
      fares: expect.objectContaining({ amount_paise: 450_000 }),
    });
    expect(data?.next_cursor).toBe(encodeHistoryCursor({ key: 1_700_000_000_000, id: 'b_20' }));
  });

  it('a later page decodes the cursor and skips the summary', async () => {
    const { repo, call } = harness();
    const cursor = encodeHistoryCursor({ key: 1_699_000_000_000, id: 'b_40' });
    const { data } = await call({ limit: '20', cursor });

    expect(repo.pageForDriver).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { key: 1_699_000_000_000, id: 'b_40' } }),
    );
    expect(repo.driverHistorySummary).not.toHaveBeenCalled();
    expect(data?.summary).toBeNull();
  });

  it('a search also matches customers by name, through identity', async () => {
    const { repo, directory, call } = harness();
    await call({ limit: '20', q: 'rajdeep' });

    expect(directory.idsMatching).toHaveBeenCalledWith('CUSTOMER', 'rajdeep', expect.any(Number));
    expect(repo.pageForDriver).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'rajdeep', customerIds: ['cus_9'] }),
    );
  });

  it('refuses a cursor that does not decode', async () => {
    const { repo, call } = harness();
    const { error } = await call({ limit: '20', cursor: 'not-a-cursor' });

    expect(error).toBeDefined();
    expect(repo.pageForDriver).not.toHaveBeenCalled();
  });
});
