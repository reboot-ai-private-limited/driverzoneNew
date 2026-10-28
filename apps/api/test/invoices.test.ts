import { describe, expect, it } from 'vitest';
import { gstStateOf, type GstInvoiceStatus } from '@driverzone/contracts';
import type { Booking } from '../src/modules/bookings/domain/booking.entity.js';
import { GetGstInvoiceForTripUseCase } from '../src/modules/invoices/application/useCases/getGstInvoiceForTrip.usecase.js';
import { RequestGstInvoiceUseCase } from '../src/modules/invoices/application/useCases/requestGstInvoice.usecase.js';
import { ResolveGstInvoiceUseCase } from '../src/modules/invoices/application/useCases/resolveGstInvoice.usecase.js';
import type {
  GstInvoiceRequest,
  NewGstInvoiceRequest,
} from '../src/modules/invoices/domain/gstInvoice.entity.js';
import type { GstInvoiceRepositoryPort } from '../src/modules/invoices/domain/gstInvoiceRepository.port.js';
import { createGstInvoiceSchema, resolveGstInvoiceSchema } from '../src/modules/invoices/interface/invoices.validation.js';

/**
 * GST INVOICE REQUESTS — one per completed trip, the customer's own, answered once by the team.
 */

const GSTIN = '19ABCDE1234F1Z5';

function trip(over: Partial<Booking> = {}): Booking {
  return {
    id: 'bkg_1',
    reference: 'DZ-AB12CD',
    customerId: 'cus_1',
    status: 'COMPLETED',
    fareSnapshot: { fare: { totalPaise: 52_500 } },
    ...over,
  } as Booking;
}

function fakeRepo(seed: GstInvoiceRequest[] = []): GstInvoiceRepositoryPort & { rows: GstInvoiceRequest[] } {
  const rows = [...seed];
  let n = 0;
  return {
    rows,
    async create(request: NewGstInvoiceRequest) {
      if (rows.some((r) => r.bookingId === request.bookingId)) {
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      }
      n += 1;
      const row: GstInvoiceRequest = {
        ...request,
        id: `gst_${n}`,
        status: 'PENDING',
        invoiceNumber: null,
        adminNote: null,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: new Date(2026, 9, 28, 10, n),
      };
      rows.push(row);
      return row;
    },
    async findByBooking(bookingId) {
      return rows.find((r) => r.bookingId === bookingId) ?? null;
    },
    async findLatestForCustomer(customerId) {
      const mine = rows.filter((r) => r.customerId === customerId);
      return mine.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    },
    async listForAdmin(filter: { status?: GstInvoiceStatus | undefined }) {
      return rows.filter((r) => filter.status === undefined || r.status === filter.status);
    },
    async resolve(id, resolution) {
      const row = rows.find((r) => r.id === id && r.status === 'PENDING');
      if (row === undefined) return null;
      Object.assign(row, resolution);
      return row;
    },
  };
}

const bookingsOf = (...trips: Booking[]) => ({
  findById: async (id: string) => trips.find((t) => t.id === id) ?? null,
});

const input = {
  customerId: 'cus_1',
  bookingId: 'bkg_1',
  gstin: ` ${GSTIN.toLowerCase()} `,
  legalName: ' Siliguri Traders Pvt Ltd ',
  billingAddress: 'Hill Cart Road, Siliguri',
  pincode: '734001',
  sendToWhatsapp: '+919876543210',
};

describe('gstStateOf', () => {
  it('reads the state off the first two digits', () => {
    expect(gstStateOf(GSTIN)).toBe('West Bengal');
    expect(gstStateOf('10ABCDE1234F1Z5')).toBe('Bihar');
  });

  it('refuses a malformed GSTIN or an unknown state code', () => {
    expect(gstStateOf('19ABCDE1234F1X5')).toBeNull(); // 14th character must be Z
    expect(gstStateOf('99ABCDE1234F1Z5')).toBeNull(); // no state 99
    expect(gstStateOf('19ABCDE1234')).toBeNull();
  });
});

describe('RequestGstInvoiceUseCase', () => {
  it('records the request with the state read off the GSTIN and the fare frozen', async () => {
    const repo = fakeRepo();
    const created = await new RequestGstInvoiceUseCase(repo, bookingsOf(trip())).execute(input);

    expect(created).toMatchObject({
      bookingReference: 'DZ-AB12CD',
      gstin: GSTIN,
      legalName: 'Siliguri Traders Pvt Ltd',
      stateName: 'West Bengal',
      sendToWhatsapp: '+919876543210',
      sendToEmail: null,
      fareTotalPaise: 52_500,
      status: 'PENDING',
    });
  });

  it('accepts an email instead of WhatsApp, lowercased', async () => {
    const repo = fakeRepo();
    const created = await new RequestGstInvoiceUseCase(repo, bookingsOf(trip())).execute({
      ...input,
      sendToWhatsapp: undefined,
      sendToEmail: ' Accounts@Example.com ',
    });
    expect(created.sendToEmail).toBe('accounts@example.com');
  });

  it('needs somewhere to send the invoice', async () => {
    await expect(
      new RequestGstInvoiceUseCase(fakeRepo(), bookingsOf(trip())).execute({ ...input, sendToWhatsapp: '  ' }),
    ).rejects.toThrow(/WhatsApp number or an email/);
  });

  it("refuses somebody else's trip as if it did not exist", async () => {
    await expect(
      new RequestGstInvoiceUseCase(fakeRepo(), bookingsOf(trip({ customerId: 'cus_other' }))).execute(input),
    ).rejects.toThrow(/does not exist/);
  });

  it('refuses a trip that is not complete', async () => {
    await expect(
      new RequestGstInvoiceUseCase(fakeRepo(), bookingsOf(trip({ status: 'STARTED' }))).execute(input),
    ).rejects.toThrow(/once the trip is complete/);
  });

  it('refuses a GSTIN whose state code does not exist', async () => {
    await expect(
      new RequestGstInvoiceUseCase(fakeRepo(), bookingsOf(trip())).execute({ ...input, gstin: '99ABCDE1234F1Z5' }),
    ).rejects.toThrow(/state code/);
  });

  it('allows one request per trip', async () => {
    const repo = fakeRepo();
    const useCase = new RequestGstInvoiceUseCase(repo, bookingsOf(trip()));
    await useCase.execute(input);
    await expect(useCase.execute(input)).rejects.toThrow(/already been requested/);
  });
});

describe('GetGstInvoiceForTripUseCase', () => {
  it("returns this trip's request, with no pre-fill", async () => {
    const repo = fakeRepo();
    await new RequestGstInvoiceUseCase(repo, bookingsOf(trip())).execute(input);

    const result = await new GetGstInvoiceForTripUseCase(repo, bookingsOf(trip())).execute({
      customerId: 'cus_1',
      bookingId: 'bkg_1',
    });
    expect(result.request?.bookingId).toBe('bkg_1');
    expect(result.prefill).toBeNull();
  });

  it("pre-fills a new trip's form from the customer's last request", async () => {
    const repo = fakeRepo();
    const trips = bookingsOf(trip(), trip({ id: 'bkg_2', reference: 'DZ-XY98ZW' }));
    await new RequestGstInvoiceUseCase(repo, trips).execute(input);

    const result = await new GetGstInvoiceForTripUseCase(repo, trips).execute({
      customerId: 'cus_1',
      bookingId: 'bkg_2',
    });
    expect(result.request).toBeNull();
    expect(result.prefill?.gstin).toBe(GSTIN);
  });

  it("refuses somebody else's trip", async () => {
    await expect(
      new GetGstInvoiceForTripUseCase(fakeRepo(), bookingsOf(trip())).execute({
        customerId: 'cus_other',
        bookingId: 'bkg_1',
      }),
    ).rejects.toThrow(/does not exist/);
  });
});

describe('ResolveGstInvoiceUseCase', () => {
  async function pending() {
    const repo = fakeRepo();
    const created = await new RequestGstInvoiceUseCase(repo, bookingsOf(trip())).execute(input);
    return { repo, id: created.id };
  }

  it('marks a request sent, with its invoice number', async () => {
    const { repo, id } = await pending();
    const resolved = await new ResolveGstInvoiceUseCase(repo).execute({
      id,
      adminId: 'adm_1',
      status: 'SENT',
      invoiceNumber: ' DZ/2026/0042 ',
    });
    expect(resolved).toMatchObject({ status: 'SENT', invoiceNumber: 'DZ/2026/0042', resolvedBy: 'adm_1' });
  });

  it('needs a reason to reject — the customer reads it', async () => {
    const { repo, id } = await pending();
    await expect(
      new ResolveGstInvoiceUseCase(repo).execute({ id, adminId: 'adm_1', status: 'REJECTED' }),
    ).rejects.toThrow(/Say why/);
  });

  it('drops an invoice number typed against a rejection', async () => {
    const { repo, id } = await pending();
    const resolved = await new ResolveGstInvoiceUseCase(repo).execute({
      id,
      adminId: 'adm_1',
      status: 'REJECTED',
      invoiceNumber: 'DZ/1',
      note: 'GSTIN does not match the business name',
    });
    expect(resolved.invoiceNumber).toBeNull();
  });

  it('answers once — a second answer is refused, not applied', async () => {
    const { repo, id } = await pending();
    const useCase = new ResolveGstInvoiceUseCase(repo);
    await useCase.execute({ id, adminId: 'adm_1', status: 'SENT', invoiceNumber: 'DZ/1' });
    await expect(
      useCase.execute({ id, adminId: 'adm_2', status: 'SENT', invoiceNumber: 'DZ/2' }),
    ).rejects.toThrow(/already been answered/);
    expect(repo.rows[0]?.invoiceNumber).toBe('DZ/1');
  });
});

describe('createGstInvoiceSchema', () => {
  const body = {
    gstin: GSTIN.toLowerCase(),
    legal_name: 'Siliguri Traders',
    billing_address: 'Hill Cart Road, Siliguri',
    pincode: '734001',
  };

  it('uppercases the GSTIN and treats blank contact fields as absent', () => {
    const parsed = createGstInvoiceSchema.parse({ ...body, send_to_whatsapp: '', send_to_email: 'a@b.in' });
    expect(parsed.gstin).toBe(GSTIN);
    expect(parsed.send_to_whatsapp).toBeUndefined();
    expect(parsed.send_to_email).toBe('a@b.in');
  });

  it.each([
    ['a short GSTIN', { gstin: '19ABCDE1234' }],
    ['a 5-digit pincode', { pincode: '73400' }],
    ['a pincode starting with 0', { pincode: '034001' }],
    ['a national WhatsApp number', { send_to_whatsapp: '9876543210' }],
    ['a bad email', { send_to_email: 'not-an-email' }],
    ['an unknown field', { state: 'West Bengal' }],
  ])('refuses %s', (_label, over) => {
    expect(createGstInvoiceSchema.safeParse({ ...body, ...over }).success).toBe(false);
  });
});

describe('resolveGstInvoiceSchema', () => {
  it('allows only SENT or REJECTED — never back to PENDING', () => {
    expect(resolveGstInvoiceSchema.safeParse({ status: 'SENT' }).success).toBe(true);
    expect(resolveGstInvoiceSchema.safeParse({ status: 'PENDING' }).success).toBe(false);
  });
});
