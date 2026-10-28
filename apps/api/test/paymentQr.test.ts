import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Booking } from '../src/modules/bookings/domain/booking.entity.js';
import type { BookingRepositoryPort } from '../src/modules/bookings/domain/bookingRepository.port.js';
import type { BookingExtension } from '../src/modules/bookings/domain/bookingExtension.entity.js';
import type { ExtensionRepositoryPort } from '../src/modules/bookings/domain/extensionRepository.port.js';
import { ApplyCapturedPaymentUseCase } from '../src/modules/bookings/application/useCases/applyCapturedPayment.usecase.js';
import { DriverPaymentQrUseCase } from '../src/modules/bookings/application/useCases/driverPaymentQr.usecase.js';
import { toPaymentQrDto } from '../src/modules/bookings/interface/bookings.mapper.js';
import type { NotificationsContract } from '../src/modules/notifications/notifications.public.js';
import { HandleWebhookUseCase } from '../src/modules/payments/application/useCases/handleWebhook.usecase.js';
import {
  CloseQrPaymentUseCase,
  CreateQrPaymentUseCase,
  RefreshQrPaymentUseCase,
} from '../src/modules/payments/application/useCases/qrPayment.usecase.js';
import type { Payment } from '../src/modules/payments/domain/payment.entity.js';
import { WebhookSignatureError } from '../src/modules/payments/domain/payment.errors.js';
import { IGNORED_WEBHOOK } from '../src/modules/payments/domain/paymentGateway.port.js';
import type { PaymentRepositoryPort } from '../src/modules/payments/domain/paymentRepository.port.js';
import { MockPaymentGateway } from '../src/modules/payments/infrastructure/mock.gateway.js';
import { RazorpayGateway } from '../src/modules/payments/infrastructure/razorpay.gateway.js';
import type { PaymentsContract } from '../src/modules/payments/payments.public.js';
import { buildSnapshot } from '../src/modules/settings/domain/setting.entity.js';

/**
 * THE DRIVER'S PAYMENT QR — the driver shows a UPI QR for the WHOLE trip, the customer scans it,
 * the server confirms the money, and only then does "end trip" unlock.
 *
 * The properties worth pinning are the ones that cost real money when wrong: the amount is the
 * whole trip and nothing is asked for twice, a payment is credited exactly once however the news
 * arrives, a duplicate payment is refunded, and a hostile or wrong credit never marks a trip paid.
 */

// ─── Fakes ─────────────────────────────────────────────────────────────────────────────────────

function fakePaymentRepo() {
  const rows: Payment[] = [];
  const processed = new Set<string>();
  let n = 0;
  let tick = 0;
  const touch = () => new Date(Date.UTC(2026, 9, 28, 10, 0, 0) + (tick += 1) * 1000);

  const repo: PaymentRepositoryPort & { rows: Payment[] } = {
    rows,
    async create(data) {
      const existing = rows.find((r) => r.idempotencyKey === data.idempotencyKey);
      if (existing !== undefined) return existing;
      n += 1;
      const row: Payment = {
        id: `pay_${n}`,
        bookingId: data.bookingId,
        customerId: data.customerId,
        kind: data.kind,
        channel: data.channel ?? 'ORDER',
        metadata: data.metadata ?? {},
        qr: null,
        status: 'CREATED',
        amountPaise: data.amountPaise,
        refundedPaise: 0,
        gatewayRef: null,
        providerPaymentId: null,
        idempotencyKey: data.idempotencyKey,
        failureReason: null,
        createdAt: touch(),
        updatedAt: touch(),
      };
      rows.push(row);
      return row;
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async findByIdempotencyKey(key) {
      return rows.find((r) => r.idempotencyKey === key) ?? null;
    },
    async findByGatewayRef(ref) {
      return rows.find((r) => r.gatewayRef === ref) ?? null;
    },
    async listForBooking(bookingId) {
      return rows.filter((r) => r.bookingId === bookingId);
    },
    async transition(id, from, to, patch = {}) {
      const row = rows.find((r) => r.id === id && r.status === from);
      if (row === undefined) return null;
      Object.assign(row, { status: to, updatedAt: touch() }, patch);
      return row;
    },
    async attachGatewayRef(id, gatewayRef) {
      const row = rows.find((r) => r.id === id);
      if (row === undefined) return null;
      row.gatewayRef = gatewayRef;
      return row;
    },
    async markEventProcessed(eventId) {
      if (processed.has(eventId)) return false;
      processed.add(eventId);
      return true;
    },
  };
  return repo;
}

const EXPIRES = new Date('2026-10-28T10:15:00Z');

async function makeQr(
  repo: PaymentRepositoryPort,
  gateway: MockPaymentGateway,
  over: { amountPaise?: number; key?: string; metadata?: Record<string, number> } = {},
) {
  return new CreateQrPaymentUseCase(repo, gateway).execute({
    bookingId: 'bkg_1',
    customerId: 'cus_1',
    kind: 'BOOKING',
    amountPaise: over.amountPaise ?? 52_500,
    reference: 'DZ-AB12CD',
    idempotencyKey: over.key ?? 'qr-bkg_1-52500-0',
    expiresAt: EXPIRES,
    metadata: over.metadata ?? { farePaise: 52_500 },
  });
}

// ─── The Razorpay adapter ──────────────────────────────────────────────────────────────────────

describe('RazorpayGateway — QR codes', () => {
  const WEBHOOK_SECRET = 'whsec_test';
  const gateway = new RazorpayGateway({ keyId: 'rzp_test_x', keySecret: 'secret', webhookSecret: WEBHOOK_SECRET });
  const sign = (body: string) => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  const verify = (event: unknown) => {
    const body = JSON.stringify(event);
    return gateway.verifyWebhook({ rawBody: body, signature: sign(body), eventId: 'evt_1' });
  };

  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (payload: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

  it('asks for a single-use, fixed-amount UPI QR in paise, closing at a unix-seconds timestamp', async () => {
    stubFetch({ id: 'qr_ABC', image_url: 'https://rzp.io/qr.png', image_content: 'upi://pay?pa=x@y&am=525.00' });

    const qr = await gateway.createQrCode({
      amountPaise: 52_500,
      reference: 'DZ-AB12CD',
      idempotencyKey: 'k',
      expiresAt: EXPIRES,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(url).toMatch(/\/payments\/qr_codes$/);
    expect(body).toMatchObject({
      type: 'upi_qr',
      usage: 'single_use',
      fixed_amount: true, // what makes single_use legal, and what stops a customer underpaying
      payment_amount: 52_500,
      close_by: Math.floor(EXPIRES.getTime() / 1000),
    });
    expect(qr).toEqual({
      gatewayRef: 'qr_ABC',
      upiUri: 'upi://pay?pa=x@y&am=525.00',
      imageUrl: 'https://rzp.io/qr.png',
    });
  });

  it('only trusts `image_content` when it really is a UPI link', async () => {
    stubFetch({ id: 'qr_ABC', image_url: 'https://rzp.io/qr.png', image_content: 'iVBORw0KGgo=' });
    const qr = await gateway.createQrCode({ amountPaise: 52_500, reference: 'DZ-1', idempotencyKey: 'k', expiresAt: EXPIRES });
    expect(qr.upiUri).toBeNull();
    expect(qr.imageUrl).toBe('https://rzp.io/qr.png');
  });

  it('refuses under ₹1 before calling out', async () => {
    stubFetch({});
    await expect(
      gateway.createQrCode({ amountPaise: 50, reference: 'DZ-1', idempotencyKey: 'k', expiresAt: EXPIRES }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a QR as paid only for a CAPTURED payment', async () => {
    stubFetch({ items: [{ id: 'pay_1', status: 'created', amount: 52_500 }] });
    expect(await gateway.fetchQrCredit('qr_ABC')).toBeNull();

    stubFetch({ items: [{ id: 'pay_1', status: 'captured', amount: 52_500 }] });
    expect(await gateway.fetchQrCredit('qr_ABC')).toEqual({ providerPaymentId: 'pay_1', amountPaise: 52_500 });
  });

  it('turns a QR credit into a capture against the QR\'s own id', () => {
    const event = verify({
      event: 'qr_code.credited',
      payload: { qr_code: { entity: { id: 'qr_ABC' } }, payment: { entity: { id: 'pay_9', amount: 52_500 } } },
    });
    expect(event).toMatchObject({
      type: 'PAYMENT_CAPTURED',
      gatewayRef: 'qr_ABC',
      providerPaymentId: 'pay_9',
      amountPaise: 52_500,
    });
  });

  it('reports a QR that expired unpaid — but not the close of one that was paid', () => {
    const expired = verify({
      event: 'qr_code.closed',
      payload: { qr_code: { entity: { id: 'qr_ABC', close_reason: 'on_demand' } } },
    });
    expect(expired).toMatchObject({ type: 'QR_CLOSED', gatewayRef: 'qr_ABC' });

    // A single-use QR closes itself the instant it is paid. Reporting that would mark a PAID trip's
    // QR as expired.
    const paid = verify({
      event: 'qr_code.closed',
      payload: { qr_code: { entity: { id: 'qr_ABC', close_reason: 'paid' } } },
    });
    expect(paid).toBe(IGNORED_WEBHOOK);
  });

  it("ignores — rather than rejects — a QR payment's own payment.captured, which has no order", () => {
    // Razorpay sends this for EVERY captured payment. Answering it 401 made it redeliver for hours.
    const event = verify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_9', amount: 52_500, order_id: null } } },
    });
    expect(event).toBe(IGNORED_WEBHOOK);
  });

  it('still answers a bad signature with null, which the caller turns into a 401', () => {
    const body = JSON.stringify({ event: 'qr_code.credited', payload: {} });
    expect(gateway.verifyWebhook({ rawBody: body, signature: 'forged', eventId: 'e' })).toBeNull();
  });
});

// ─── Creating, closing and refreshing a QR ─────────────────────────────────────────────────────

describe('QR payment life cycle', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-28T10:00:00Z').getTime()));
  afterEach(() => vi.restoreAllMocks());

  it('stores the QR as a pending payment with its link and expiry', async () => {
    const repo = fakePaymentRepo();
    const payment = await makeQr(repo, new MockPaymentGateway(false));

    expect(payment).toMatchObject({ status: 'PENDING', channel: 'QR', amountPaise: 52_500 });
    expect(payment.gatewayRef).toMatch(/^mock_qr_/);
    expect(payment.qr?.upiUri).toMatch(/^upi:\/\/pay\?/);
    expect(payment.qr?.expiresAt).toEqual(EXPIRES);
  });

  it('a double-tapped create returns the same payment, never a second live QR', async () => {
    const repo = fakePaymentRepo();
    const gateway = new MockPaymentGateway(false);
    const create = vi.spyOn(gateway, 'createQrCode');

    const first = await makeQr(repo, gateway);
    const second = await makeQr(repo, gateway);

    expect(second.id).toBe(first.id);
    expect(create).toHaveBeenCalledTimes(1);
    expect(repo.rows).toHaveLength(1);
  });

  it('closes out the row when the gateway refuses, so the next tap starts clean', async () => {
    const repo = fakePaymentRepo();
    const gateway = new MockPaymentGateway(false);
    vi.spyOn(gateway, 'createQrCode').mockRejectedValueOnce(new Error('gateway down'));

    await expect(makeQr(repo, gateway)).rejects.toThrow('gateway down');
    expect(repo.rows[0]?.status).toBe('FAILED');
  });

  it('closing marks a pending QR failed and leaves a paid one alone', async () => {
    const repo = fakePaymentRepo();
    const gateway = new MockPaymentGateway(false);
    const close = new CloseQrPaymentUseCase(repo, gateway);

    const pending = await makeQr(repo, gateway);
    await close.execute(pending.id, 'Replaced');
    expect(repo.rows[0]).toMatchObject({ status: 'FAILED', failureReason: 'Replaced' });

    const paid = await makeQr(repo, gateway, { key: 'k2' });
    await repo.transition(paid.id, 'PENDING', 'CAPTURED');
    await close.execute(paid.id, 'Replaced');
    expect(repo.rows[1]?.status).toBe('CAPTURED');
  });

  describe('refreshing', () => {
    it('captures a paid QR exactly once, however many times it is asked', async () => {
      const repo = fakePaymentRepo();
      const gateway = new MockPaymentGateway(false);
      const refresh = new RefreshQrPaymentUseCase(repo, gateway, 0);
      const payment = await makeQr(repo, gateway);

      expect((await refresh.execute(payment.id))?.justCaptured).toBe(false); // nobody has paid yet

      MockPaymentGateway.payQr(payment.gatewayRef as string);
      const first = await refresh.execute(payment.id);
      expect(first).toMatchObject({ justCaptured: true, payment: { status: 'CAPTURED' } });

      // The webhook, or a second poll, arriving after: reports paid, but is NOT the one that captured.
      const second = await refresh.execute(payment.id);
      expect(second).toMatchObject({ justCaptured: false, payment: { status: 'CAPTURED' } });
    });

    it('does not mark a trip paid on a credit for the wrong amount', async () => {
      const repo = fakePaymentRepo();
      const gateway = new MockPaymentGateway(false);
      const refresh = new RefreshQrPaymentUseCase(repo, gateway, 0);
      const payment = await makeQr(repo, gateway);

      MockPaymentGateway.payQr(payment.gatewayRef as string);
      vi.spyOn(gateway, 'fetchQrCredit').mockResolvedValueOnce({ providerPaymentId: 'p', amountPaise: 100 });

      expect((await refresh.execute(payment.id))?.payment.status).toBe('PENDING');
    });

    it('expires a QR that ran out of time, and closes it at the gateway', async () => {
      const repo = fakePaymentRepo();
      const gateway = new MockPaymentGateway(false);
      const close = vi.spyOn(gateway, 'closeQrCode');
      const payment = await makeQr(repo, gateway);

      const late = new RefreshQrPaymentUseCase(repo, gateway, 0, () => EXPIRES.getTime() + 1);
      const result = await late.execute(payment.id);

      expect(result?.payment).toMatchObject({ status: 'FAILED', failureReason: 'The QR code expired' });
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('does not put the same QR to the gateway more than once in the throttle window', async () => {
      const repo = fakePaymentRepo();
      const gateway = new MockPaymentGateway(false);
      const ask = vi.spyOn(gateway, 'fetchQrCredit');
      const payment = await makeQr(repo, gateway);

      let clock = 1_000_000;
      const refresh = new RefreshQrPaymentUseCase(repo, gateway, 3_000, () => clock);
      await refresh.execute(payment.id);
      clock += 1_000;
      await refresh.execute(payment.id);
      expect(ask).toHaveBeenCalledTimes(1);

      clock += 3_000;
      await refresh.execute(payment.id);
      expect(ask).toHaveBeenCalledTimes(2);
    });

    it('survives the gateway being down — the webhook may still land', async () => {
      const repo = fakePaymentRepo();
      const gateway = new MockPaymentGateway(false);
      const payment = await makeQr(repo, gateway);
      vi.spyOn(gateway, 'fetchQrCredit').mockRejectedValueOnce(new Error('timeout'));

      const result = await new RefreshQrPaymentUseCase(repo, gateway, 0).execute(payment.id);
      expect(result?.payment.status).toBe('PENDING');
    });
  });
});

// ─── The webhook ───────────────────────────────────────────────────────────────────────────────

describe('HandleWebhookUseCase — QR payments', () => {
  async function setup() {
    const repo = fakePaymentRepo();
    const gateway = new MockPaymentGateway(false);
    const payment = await makeQr(repo, gateway);
    const webhook = new HandleWebhookUseCase(repo, gateway);
    const deliver = (event: Parameters<typeof MockPaymentGateway.signedWebhook>[0]) => {
      const { body, signature } = MockPaymentGateway.signedWebhook(event);
      return webhook.execute({ rawBody: body, signature, eventId: undefined });
    };
    return { repo, payment, deliver, ref: payment.gatewayRef as string, webhook };
  }

  it('captures the QR payment on a matching credit', async () => {
    const { repo, deliver, ref } = await setup();
    const outcome = await deliver({
      eventId: 'e1',
      type: 'PAYMENT_CAPTURED',
      gatewayRef: ref,
      providerPaymentId: 'pay_9',
      amountPaise: 52_500,
    });
    expect(outcome).toMatchObject({ handled: true, kind: 'CAPTURED' });
    expect(repo.rows[0]?.status).toBe('CAPTURED');
  });

  it('refuses to mark a trip paid on a credit for a different amount', async () => {
    const { repo, deliver, ref } = await setup();
    const outcome = await deliver({
      eventId: 'e1',
      type: 'PAYMENT_CAPTURED',
      gatewayRef: ref,
      providerPaymentId: 'pay_9',
      amountPaise: 100,
    });
    expect(outcome).toEqual({ handled: false, reason: 'NOT_APPLICABLE' });
    expect(repo.rows[0]?.status).toBe('PENDING');
  });

  it('expires the QR on QR_CLOSED, with no booking-side effect', async () => {
    const { repo, deliver, ref } = await setup();
    const outcome = await deliver({ eventId: 'e1', type: 'QR_CLOSED', gatewayRef: ref, amountPaise: 0 });
    expect(outcome.handled).toBe(false);
    expect(repo.rows[0]).toMatchObject({ status: 'FAILED', failureReason: 'The QR code expired' });
  });

  it('a close arriving AFTER the credit does not undo it', async () => {
    const { repo, deliver, ref } = await setup();
    await deliver({ eventId: 'e1', type: 'PAYMENT_CAPTURED', gatewayRef: ref, providerPaymentId: 'p', amountPaise: 52_500 });
    await deliver({ eventId: 'e2', type: 'QR_CLOSED', gatewayRef: ref, amountPaise: 0 });
    expect(repo.rows[0]?.status).toBe('CAPTURED');
  });

  it('answers an authentic event it does not act on with a plain no-op, not a 401', async () => {
    const { deliver } = await setup();
    // Verified, but not a shape the mock turns into an event.
    const { body, signature } = MockPaymentGateway.signedWebhook({ type: 'SOMETHING_ELSE' } as never);
    const webhook = new HandleWebhookUseCase(fakePaymentRepo(), new MockPaymentGateway(false));
    await expect(webhook.execute({ rawBody: body, signature, eventId: undefined })).resolves.toEqual({
      handled: false,
      reason: 'NOT_APPLICABLE',
    });
    void deliver;
  });

  it('still refuses a forged signature', async () => {
    const { webhook } = await setup();
    await expect(
      webhook.execute({ rawBody: '{}', signature: 'forged', eventId: undefined }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});

// ─── What the QR collects ──────────────────────────────────────────────────────────────────────

describe('DriverPaymentQrUseCase', () => {
  const NOW = new Date('2026-10-28T10:00:00Z');

  function trip(over: Partial<Booking> = {}): Booking {
    return {
      id: 'bkg_1',
      reference: 'DZ-AB12CD',
      customerId: 'cus_1',
      driverId: 'drv_1',
      status: 'STARTED',
      paymentMode: null,
      paymentStatus: 'NOT_SELECTED',
      fareSnapshot: { fare: { totalPaise: 52_500 } },
      paidExtensionPaise: 0,
      walletCreditPaise: 0,
      walletDebtPaise: 0,
      arrivedAt: new Date('2026-10-28T09:20:00Z'),
      startedAt: new Date('2026-10-28T09:25:00Z'), // 5 minutes: inside the free 15
      ...over,
    } as Booking;
  }

  const accepted = (amountPaise: number): BookingExtension =>
    ({ id: 'ext_1', bookingId: 'bkg_1', status: 'ACCEPTED', amountPaise, driverAmountPaise: 0 }) as BookingExtension;

  function build(booking: Booking, extensionRows: BookingExtension[] = []) {
    const paymentRepo = fakePaymentRepo();
    const gateway = new MockPaymentGateway(false);
    const createQr = new CreateQrPaymentUseCase(paymentRepo, gateway);
    const closeQr = new CloseQrPaymentUseCase(paymentRepo, gateway);
    // The same clock as the use case, or a QR made at the fixed NOW looks long expired.
    const refreshQr = new RefreshQrPaymentUseCase(paymentRepo, gateway, 0, () => NOW.getTime());

    const payments = {
      listForBooking: (id: string) => paymentRepo.listForBooking(id),
      findById: (id: string) => paymentRepo.findById(id),
      chargeByQr: (input: Parameters<typeof createQr.execute>[0]) => createQr.execute(input),
      closeQr: (id: string, reason: string) => closeQr.execute(id, reason),
      refreshQr: (id: string) => refreshQr.execute(id),
    } as unknown as PaymentsContract;

    const repo = {
      findById: vi.fn(async () => booking),
      setPaymentMode: vi.fn(async () => booking),
      attachPayment: vi.fn(async () => undefined),
    } as unknown as BookingRepositoryPort;

    const notifications = { sendBookingUpdate: vi.fn(async () => undefined) } as unknown as NotificationsContract;
    const onCaptured = vi.fn(async () => undefined);

    const useCase = new DriverPaymentQrUseCase(
      repo,
      payments,
      { listForBooking: async () => extensionRows } as unknown as ExtensionRepositoryPort,
      { snapshot: async () => buildSnapshot([]), get: async (k: never) => buildSnapshot([])[k] },
      notifications,
      onCaptured,
      () => NOW,
    );

    return { useCase, repo, paymentRepo, notifications, onCaptured };
  }

  const input = { bookingId: 'bkg_1', driverId: 'drv_1' };

  it('charges the whole trip, and makes the QR the trip\'s online payment', async () => {
    const { useCase, repo, notifications } = build(trip());
    const result = await useCase.create(input);

    expect(result.qr.state).toBe('PENDING');
    expect(result.qr.payment?.amountPaise).toBe(52_500);
    // The system already knows what to do with a UPI trip: the end-trip slide waits for a capture.
    expect(repo.setPaymentMode).toHaveBeenCalledWith('bkg_1', 'UPI', 'AWAITING_PAYMENT');
    expect(repo.attachPayment).toHaveBeenCalledWith('bkg_1', result.qr.payment?.id);
    expect(notifications.sendBookingUpdate).toHaveBeenCalledTimes(1);
  });

  it('adds an unpaid extra day and the waiting charge, and takes off wallet credit', async () => {
    const { useCase } = build(
      trip({
        // 40 minutes waited: 15 free, 25 chargeable at ₹2 = ₹50.
        arrivedAt: new Date('2026-10-28T09:00:00Z'),
        startedAt: new Date('2026-10-28T09:40:00Z'),
        walletCreditPaise: 10_000,
        walletDebtPaise: 2_000,
      }),
      [accepted(300_000)],
    );

    const { qr } = await useCase.create(input);

    // 525 fare + 3,000 extra day + 50 waiting − 100 credit + 20 earlier dues
    expect(qr.payment?.amountPaise).toBe(52_500 + 300_000 + 5_000 - 10_000 + 2_000);
    expect(qr.payment?.metadata).toEqual({
      farePaise: 52_500,
      extensionPaise: 300_000,
      waitingPaise: 5_000,
      creditPaise: 10_000,
      debtPaise: 2_000,
    });
  });

  it('leaves out an extra day the customer already paid online', async () => {
    const { useCase } = build(trip({ paidExtensionPaise: 300_000 }), [accepted(300_000)]);
    const { qr } = await useCase.create(input);
    expect(qr.payment?.amountPaise).toBe(52_500);
    expect(qr.payment?.metadata['extensionPaise']).toBe(0);
  });

  it('shows the same QR again while it is still right — a second tap is not a second QR', async () => {
    const { useCase, paymentRepo } = build(trip());
    const first = await useCase.create(input);
    const second = await useCase.create(input);

    expect(second.qr.payment?.id).toBe(first.qr.payment?.id);
    expect(paymentRepo.rows).toHaveLength(1);
  });

  it('replaces a live QR whose amount is no longer right, closing the old one', async () => {
    const extensionRows: BookingExtension[] = [];
    const { useCase, paymentRepo } = build(trip(), extensionRows);
    const first = await useCase.create(input);

    // An extra day was accepted since: the trip now costs more than the QR on screen says.
    extensionRows.push(accepted(300_000));
    const second = await useCase.create(input);

    expect(second.qr.payment?.amountPaise).toBe(352_500);
    expect(second.qr.payment?.id).not.toBe(first.qr.payment?.id);
    const old = paymentRepo.rows.find((r) => r.id === first.qr.payment?.id);
    expect(old).toMatchObject({ status: 'FAILED', failureReason: 'Replaced by a new QR' });
    expect(paymentRepo.rows.filter((r) => r.status === 'PENDING')).toHaveLength(1);
  });

  it('refuses a trip that has not started', async () => {
    const { useCase } = build(trip({ status: 'ASSIGNED' }));
    await expect(useCase.create(input)).rejects.toThrow(/once the trip has started/);
  });

  it('refuses a prepaid trip — there is nothing to collect', async () => {
    const { useCase } = build(trip({ paymentMode: 'PREPAID', paymentStatus: 'PAID' }));
    await expect(useCase.create(input)).rejects.toThrow(/already paid for/);
  });

  it('refuses a trip already paid online', async () => {
    const { useCase } = build(trip({ paymentMode: 'UPI', paymentStatus: 'PAID' }));
    await expect(useCase.create(input)).rejects.toThrow(/already been paid/);
  });

  it('refuses when the wallet covers the trip — there is nothing to scan', async () => {
    const { useCase } = build(trip({ walletCreditPaise: 52_500 }));
    await expect(useCase.create(input)).rejects.toThrow(/nothing left to collect/);
  });

  it("will not make a QR for another driver's trip", async () => {
    const { useCase } = build(trip());
    await expect(useCase.create({ bookingId: 'bkg_1', driverId: 'drv_other' })).rejects.toThrow();
  });

  describe('status', () => {
    it('is NONE before any QR exists', async () => {
      const { useCase } = build(trip());
      expect((await useCase.status(input)).qr.state).toBe('NONE');
    });

    it('is PENDING while unpaid, then PAID — crediting the money exactly once', async () => {
      const { useCase, onCaptured } = build(trip());
      const { qr } = await useCase.create(input);

      expect((await useCase.status(input)).qr.state).toBe('PENDING');
      expect(onCaptured).not.toHaveBeenCalled();

      MockPaymentGateway.payQr(qr.payment?.gatewayRef as string);
      expect((await useCase.status(input)).qr.state).toBe('PAID');
      expect(onCaptured).toHaveBeenCalledTimes(1);

      // The driver's screen keeps polling; none of those polls may credit it again.
      await useCase.status(input);
      await useCase.status(input);
      expect(onCaptured).toHaveBeenCalledTimes(1);
    });
  });
});

describe('toPaymentQrDto', () => {
  const qrPayment = (over: Partial<Payment> = {}): Payment => ({
    id: 'pay_1',
    bookingId: 'bkg_1',
    customerId: 'cus_1',
    kind: 'BOOKING',
    channel: 'QR',
    metadata: { farePaise: 52_500, waitingPaise: 5_000, creditPaise: 10_000, debtPaise: 0, extensionPaise: 0 },
    qr: { upiUri: 'upi://pay?x', imageUrl: null, expiresAt: EXPIRES },
    status: 'PENDING',
    amountPaise: 47_500,
    refundedPaise: 0,
    gatewayRef: 'qr_1',
    providerPaymentId: null,
    idempotencyKey: 'k',
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  it('lists what the amount is made of, from what the QR was made for', () => {
    const dto = toPaymentQrDto({ state: 'PENDING', payment: qrPayment() });
    expect(dto.lines.map((l) => [l.label, l.amount.amount_paise])).toEqual([
      ['Trip fare (incl. GST)', 52_500],
      ['Waiting charge', 5_000],
      ['Wallet credit used', -10_000],
    ]);
    expect(dto.amount?.amount_paise).toBe(47_500);
    expect(dto.waiting.amount_paise).toBe(5_000);
  });

  it('sends the link and expiry only while the QR is live', () => {
    const live = toPaymentQrDto({ state: 'PENDING', payment: qrPayment() });
    expect(live.upi_uri).toBe('upi://pay?x');
    expect(live.expires_at).toBe(EXPIRES.toISOString());

    // A paid or expired QR has nothing left to scan — and must not invite a customer to pay a dead code.
    for (const state of ['PAID', 'EXPIRED'] as const) {
      const dead = toPaymentQrDto({ state, payment: qrPayment({ status: state === 'PAID' ? 'CAPTURED' : 'FAILED' }) });
      expect(dead).toMatchObject({ upi_uri: null, image_url: null, expires_at: null });
    }
  });

  it('is empty for a trip with no QR', () => {
    expect(toPaymentQrDto({ state: 'NONE', payment: null })).toEqual({
      state: 'NONE',
      amount: null,
      upi_uri: null,
      image_url: null,
      expires_at: null,
      lines: [],
      waiting: { amount_paise: 0, amount_display: expect.any(String) },
    });
  });
});

// ─── What a capture does to the trip ───────────────────────────────────────────────────────────

describe('ApplyCapturedPaymentUseCase', () => {
  function build(payments: Payment[], booking: Partial<Booking> = { status: 'STARTED' }) {
    const repo = {
      findById: vi.fn(async () => ({ id: 'bkg_1', ...booking }) as Booking),
      addPaidExtensionPaise: vi.fn(async () => undefined),
    } as unknown as BookingRepositoryPort;
    const contract = {
      findById: async (id: string) => payments.find((p) => p.id === id) ?? null,
      listForBooking: async () => payments,
      refund: vi.fn(async () => payments[0] as Payment),
    } as unknown as PaymentsContract;
    const confirm = { execute: vi.fn(async () => undefined) };
    const confirmLate = { execute: vi.fn(async () => undefined) };
    return { useCase: new ApplyCapturedPaymentUseCase(repo, contract, confirm, confirmLate), repo, contract, confirm, confirmLate };
  }

  const pay = (over: Partial<Payment>): Payment => ({
    id: 'pay_1',
    bookingId: 'bkg_1',
    customerId: 'cus_1',
    kind: 'BOOKING',
    channel: 'ORDER',
    metadata: {},
    qr: null,
    status: 'CAPTURED',
    amountPaise: 52_500,
    refundedPaise: 0,
    gatewayRef: 'ref',
    providerPaymentId: 'p',
    idempotencyKey: 'k',
    failureReason: null,
    createdAt: new Date('2026-10-28T10:00:00Z'),
    updatedAt: new Date('2026-10-28T10:05:00Z'),
    ...over,
  });

  it("marks a running trip paid when the fare's payment lands", async () => {
    const { useCase, confirmLate, confirm } = build([pay({})]);
    await useCase.execute('bkg_1', 'pay_1');
    expect(confirmLate.execute).toHaveBeenCalledWith('bkg_1');
    expect(confirm.execute).not.toHaveBeenCalled();
  });

  it('confirms a booking that was waiting on its first payment', async () => {
    const { useCase, confirm, confirmLate } = build([pay({})], { status: 'PENDING_PAYMENT' });
    await useCase.execute('bkg_1', 'pay_1');
    expect(confirm.execute).toHaveBeenCalledWith('bkg_1');
    expect(confirmLate.execute).not.toHaveBeenCalled();
  });

  it('credits the extra day a QR collected with the fare, so the trip does not ask again', async () => {
    const qr = pay({ channel: 'QR', metadata: { extensionPaise: 300_000, waitingPaise: 5_000 } });
    const { useCase, repo } = build([qr]);
    await useCase.execute('bkg_1', 'pay_1');
    expect(repo.addPaidExtensionPaise).toHaveBeenCalledWith('bkg_1', 300_000);
  });

  it('credits nothing extra for an ordinary online order', async () => {
    const { useCase, repo } = build([pay({})]);
    await useCase.execute('bkg_1', 'pay_1');
    expect(repo.addPaidExtensionPaise).not.toHaveBeenCalled();
  });

  it('credits an extension order in full and leaves the booking status alone', async () => {
    const { useCase, repo, confirmLate } = build([pay({ kind: 'EXTENSION', amountPaise: 300_000 })]);
    await useCase.execute('bkg_1', 'pay_1');
    expect(repo.addPaidExtensionPaise).toHaveBeenCalledWith('bkg_1', 300_000);
    expect(confirmLate.execute).not.toHaveBeenCalled();
  });

  it('REFUNDS a second online payment on a trip already paid, and keeps the first', async () => {
    const first = pay({ id: 'pay_1', channel: 'ORDER', updatedAt: new Date('2026-10-28T10:05:00Z') });
    const second = pay({ id: 'pay_2', channel: 'QR', updatedAt: new Date('2026-10-28T10:09:00Z') });
    const { useCase, contract, confirmLate, repo } = build([first, second]);

    await useCase.execute('bkg_1', 'pay_2');

    expect(contract.refund).toHaveBeenCalledWith({ paymentId: 'pay_2', idempotencyKey: 'dup-refund-pay_2' });
    // The duplicate must not be credited or confirmed as if it were the payment.
    expect(confirmLate.execute).not.toHaveBeenCalled();
    expect(repo.addPaidExtensionPaise).not.toHaveBeenCalled();
  });

  it('does not refund the FIRST payment just because a later one exists', async () => {
    const first = pay({ id: 'pay_1', updatedAt: new Date('2026-10-28T10:05:00Z') });
    const second = pay({ id: 'pay_2', channel: 'QR', status: 'PENDING', updatedAt: new Date('2026-10-28T10:09:00Z') });
    const { useCase, contract, confirmLate } = build([first, second]);

    await useCase.execute('bkg_1', 'pay_1');

    expect(contract.refund).not.toHaveBeenCalled();
    expect(confirmLate.execute).toHaveBeenCalledTimes(1);
  });
});
