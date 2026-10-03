import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { ListBookingsResponse } from '@driverzone/contracts';
import { makeListCustomerBookingsController } from '../src/modules/bookings/interface/bookings.controller.js';
import { encodeHistoryCursor } from '../src/modules/bookings/interface/bookings.validation.js';
import type { BookingRepositoryPort } from '../src/modules/bookings/domain/bookingRepository.port.js';
import type { ChargeRepositoryPort } from '../src/modules/bookings/domain/chargeRepository.port.js';

/**
 * `GET /customer/bookings` — the paged history and the unpaged read older apps still make.
 *
 * The query itself is pinned against a real Mongo in `integration/customerHistory`; this is the
 * HTTP edge: which read a request reaches, what it is handed, and the response shape around it.
 */

function harness() {
  const repo = {
    listForCustomer: vi.fn(async () => []),
    pageForCustomer: vi.fn(async () => ({ bookings: [], nextCursor: { key: 1_700_000_000_000, id: 'b_20' } })),
    customerHistorySummary: vi.fn(async () => ({ totalTrips: 41, totalSpentPaise: 1_234_500 })),
  };
  const directory = {
    driverCardsByIds: vi.fn(async () => new Map()),
    idsMatching: vi.fn(async () => ['drv_1']),
  };
  const handler = makeListCustomerBookingsController(
    repo as unknown as BookingRepositoryPort,
    { listAdjustments: vi.fn(async () => []) } as unknown as ChargeRepositoryPort,
    directory as unknown as Parameters<typeof makeListCustomerBookingsController>[2],
  );

  async function call(query: Record<string, string>) {
    let body: { data: ListBookingsResponse } | undefined;
    let error: unknown;
    const req = { query, principal: { sub: 'cus_1' }, method: 'GET', originalUrl: '/' } as unknown as Request;
    const res = {
      status: () => res,
      json: (b: { data: ListBookingsResponse }) => {
        body = b;
      },
    } as unknown as Response;
    await new Promise<void>((resolve) => {
      handler(req, res, (err?: unknown) => {
        error = err;
        resolve();
      });
      // A successful handler never calls `next`; give its promise a turn to settle.
      setTimeout(resolve, 20);
    });
    return { data: body?.data, error };
  }

  return { repo, directory, call };
}

describe('GET /customer/bookings', () => {
  it('without `limit` is the old capped read: no cursor, no summary', async () => {
    const { repo, call } = harness();
    const { data } = await call({});

    expect(repo.listForCustomer).toHaveBeenCalledWith('cus_1', 100);
    expect(repo.pageForCustomer).not.toHaveBeenCalled();
    expect(data).toEqual({ bookings: [], next_cursor: null, summary: null });
  });

  it('a first page carries the summary and an opaque cursor', async () => {
    const { repo, call } = harness();
    const { data } = await call({ limit: '20' });

    expect(repo.pageForCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_1', limit: 20, sort: 'NEWEST', cursor: undefined }),
    );
    expect(data?.summary).toEqual({
      total_trips: 41,
      total_spent: expect.objectContaining({ amount_paise: 1_234_500 }),
    });
    expect(data?.next_cursor).toBe(encodeHistoryCursor({ key: 1_700_000_000_000, id: 'b_20' }));
  });

  it('a later page decodes the cursor and skips the summary', async () => {
    const { repo, call } = harness();
    const cursor = encodeHistoryCursor({ key: 55, id: 'b_9' });
    const { data } = await call({ limit: '20', cursor });

    expect(repo.pageForCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { key: 55, id: 'b_9' } }),
    );
    expect(repo.customerHistorySummary).not.toHaveBeenCalled();
    expect(data?.summary).toBeNull();
  });

  it('passes filters through and resolves driver names to ids', async () => {
    const { repo, directory, call } = harness();
    await call({
      limit: '20',
      group: 'CANCELLED',
      from: '2026-10-01T18:30:00.000Z',
      before: '2026-10-02T18:30:00.000Z',
      q: ' Rahul ',
      sort: 'AMOUNT_DESC',
    });

    expect(directory.idsMatching).toHaveBeenCalledWith('DRIVER', 'Rahul', expect.any(Number));
    expect(repo.pageForCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        group: 'CANCELLED',
        from: new Date('2026-10-01T18:30:00.000Z'),
        before: new Date('2026-10-02T18:30:00.000Z'),
        search: 'Rahul',
        driverIds: ['drv_1'],
        sort: 'AMOUNT_DESC',
      }),
    );
  });

  it('rejects a cursor that does not decode rather than restarting from the top', async () => {
    const { repo, call } = harness();
    const { error } = await call({ limit: '20', cursor: 'not-a-cursor' });

    expect(error).toBeDefined();
    expect(repo.pageForCustomer).not.toHaveBeenCalled();
  });

  it('caps the page size', async () => {
    const { error } = await harness().call({ limit: '500' });
    expect(error).toBeDefined();
  });
});
