import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IGNORED_WEBHOOK } from '../src/modules/payments/domain/paymentGateway.port.js';
import {
  RazorpayGateway,
  idempotencyKeyFor,
} from '../src/modules/payments/infrastructure/razorpay.gateway.js';

/**
 * Signatures are computed here the way Razorpay computes them, not stubbed.
 *
 * Stubbing verification would leave the single most security-sensitive line in the payment path —
 * an unauthenticated public endpoint that confirms bookings — asserted by nothing.
 */

const KEY_ID = 'rzp_test_abc123';
const KEY_SECRET = 'test-key-secret';
const WEBHOOK_SECRET = 'test-webhook-secret';

const gateway = new RazorpayGateway({
  keyId: KEY_ID,
  keySecret: KEY_SECRET,
  webhookSecret: WEBHOOK_SECRET,
});

/** Signs with the WEBHOOK secret, which is what Razorpay signs a webhook with. */
function sign(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function paymentEvent(event: string, entity: Record<string, unknown>): string {
  return JSON.stringify({ event, payload: { payment: { entity } } });
}

const CAPTURED = {
  id: 'pay_ABC123',
  order_id: 'order_XYZ789',
  amount: 108_200,
  status: 'captured',
  method: 'upi',
};

describe('verifyWebhook', () => {
  it('reads a captured payment, mapping the ORDER id to our reference', () => {
    // Our payment row stores the order id — that is what was created — so an event has to be
    // matched back by it, not by the payment id which we had never seen until now.
    const body = paymentEvent('payment.captured', CAPTURED);

    const event = gateway.verifyWebhook({
      rawBody: body,
      signature: sign(body),
      eventId: 'evt_hdr_1',
    });

    expect(event).toEqual({
      eventId: 'evt_hdr_1',
      type: 'PAYMENT_CAPTURED',
      gatewayRef: 'order_XYZ789',
      providerPaymentId: 'pay_ABC123',
      amountPaise: 108_200,
    });
  });

  it('refuses a body signed with the wrong secret', () => {
    // The key secret is NOT the webhook secret — a common and silent mix-up.
    const body = paymentEvent('payment.captured', CAPTURED);

    expect(
      gateway.verifyWebhook({
        rawBody: body,
        signature: sign(body, KEY_SECRET),
        eventId: 'evt_hdr_2',
      }),
    ).toBeNull();
  });

  it('refuses a tampered body that kept a valid signature for other content', () => {
    const original = paymentEvent('payment.captured', CAPTURED);
    const signature = sign(original);
    const tampered = paymentEvent('payment.captured', { ...CAPTURED, amount: 1 });

    expect(gateway.verifyWebhook({ rawBody: tampered, signature, eventId: 'e' })).toBeNull();
  });

  it('refuses an unsigned request outright', () => {
    const body = paymentEvent('payment.captured', CAPTURED);
    expect(gateway.verifyWebhook({ rawBody: body, signature: '', eventId: 'e' })).toBeNull();
  });

  it('maps authorized separately, because it means the money is only held', () => {
    const body = paymentEvent('payment.authorized', { ...CAPTURED, status: 'authorized' });
    const event = gateway.verifyWebhook({ rawBody: body, signature: sign(body), eventId: 'e' });
    expect(event?.type).toBe('PAYMENT_AUTHORIZED');
  });

  it('carries a decline reason through on a failure', () => {
    const body = paymentEvent('payment.failed', {
      ...CAPTURED,
      status: 'failed',
      error_description: 'Your bank declined the payment',
    });

    const event = gateway.verifyWebhook({ rawBody: body, signature: sign(body), eventId: 'e' });
    expect(event?.type).toBe('PAYMENT_FAILED');
    expect(event?.failureReason).toBe('Your bank declined the payment');
  });

  it('replaces a decline reason that is not fit to show a customer', () => {
    const body = paymentEvent('payment.failed', {
      ...CAPTURED,
      error_description: '<script>alert(1)</script>',
    });

    const event = gateway.verifyWebhook({ rawBody: body, signature: sign(body), eventId: 'e' });
    expect(event?.failureReason).toBe('The payment could not be completed. Please try again.');
  });

  it('ignores an event we never subscribed to, rather than failing on it', () => {
    // Razorpay sends events we did not ask for, and the endpoint must answer 200 to all of them
    // or they are redelivered forever. `IGNORED` (authentic, nothing to do) is NOT `null` (forged):
    // the caller turns the first into a 200 and the second into a 401. This used to return `null`
    // for both, so every unrecognised event was answered 401 and redelivered.
    const body = JSON.stringify({ event: 'subscription.charged', payload: {} });
    expect(gateway.verifyWebhook({ rawBody: body, signature: sign(body), eventId: 'e' })).toBe(
      IGNORED_WEBHOOK,
    );
  });

  it('falls back to an id derived from the body when the header is absent', () => {
    // Dedup must still collapse repeat deliveries of one event even without the header.
    const body = paymentEvent('payment.captured', CAPTURED);
    const event = gateway.verifyWebhook({
      rawBody: body,
      signature: sign(body),
      eventId: undefined,
    });
    expect(event?.eventId).toBe('payment.captured:pay_ABC123');
  });

  it('does not act on a verified body of the wrong shape', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: {} } });
    expect(gateway.verifyWebhook({ rawBody: body, signature: sign(body), eventId: 'e' })).toBe(
      IGNORED_WEBHOOK,
    );
  });
});

describe('verifyCheckoutSignature', () => {
  it('accepts the documented formula: order_id|payment_id signed with the KEY secret', () => {
    const signature = createHmac('sha256', KEY_SECRET)
      .update('order_XYZ789|pay_ABC123')
      .digest('hex');

    expect(gateway.verifyCheckoutSignature('order_XYZ789', 'pay_ABC123', signature)).toBe(true);
  });

  it('refuses one signed with the webhook secret', () => {
    const signature = createHmac('sha256', WEBHOOK_SECRET)
      .update('order_XYZ789|pay_ABC123')
      .digest('hex');

    expect(gateway.verifyCheckoutSignature('order_XYZ789', 'pay_ABC123', signature)).toBe(false);
  });

  it('refuses a signature for a different order', () => {
    // Why the docs insist the order id comes from OUR database: a client that supplies both
    // halves of the message can sign whatever it likes.
    const signature = createHmac('sha256', KEY_SECRET)
      .update('order_SOMEONE_ELSE|pay_ABC123')
      .digest('hex');

    expect(gateway.verifyCheckoutSignature('order_XYZ789', 'pay_ABC123', signature)).toBe(false);
  });
});

describe('idempotencyKeyFor', () => {
  it('strips the characters Razorpay rejects', () => {
    // `refund:<id>` shipped once and would have had every real refund rejected.
    expect(idempotencyKeyFor('refund:abc123def')).toBe('refund-abc123def');
    expect(idempotencyKeyFor('a:b/c d')).not.toMatch(/[^A-Za-z0-9_-]/);
  });

  it('pads to the ten-character minimum', () => {
    expect(idempotencyKeyFor('short').length).toBeGreaterThanOrEqual(10);
  });
});

describe('createIntent', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ id: 'order_NEW1', status: 'created' }), { status: 200 }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends paise unconverted and returns the order plus the publishable key', async () => {
    const intent = await gateway.createIntent({
      amountPaise: 108_200,
      reference: 'DZ-8F3K2M',
      idempotencyKey: 'idem-abc-123',
    });

    expect(intent.gatewayRef).toBe('order_NEW1');
    expect(intent.publicKey).toBe(KEY_ID);

    /*
     * NEVER true for Razorpay. An order is not a payment — the customer has not paid yet — and
     * claiming otherwise would confirm a booking nobody has paid for.
     */
    expect(intent.capturedImmediately).toBe(false);

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body as string,
    ) as { amount: number; currency: string; receipt: string };

    expect(body.amount).toBe(108_200);
    expect(body.currency).toBe('INR');
    expect(body.receipt.length).toBeLessThanOrEqual(40);
    expect(body.receipt).not.toMatch(/[^A-Za-z0-9_-]/);
  });

  it('refuses an order below the ₹1.00 minimum before calling out', async () => {
    await expect(
      gateway.createIntent({ amountPaise: 50, reference: 'DZ-1', idempotencyKey: 'k123456789' }),
    ).rejects.toThrow();

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('refund', () => {
  it('posts to the PAYMENT, not the order, and carries the idempotency header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'rfnd_1' }), { status: 200 })),
    );

    await gateway.refund({
      gatewayRef: 'pay_ABC123',
      amountPaise: 95_000,
      idempotencyKey: 'refund:bkg1',
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain('/payments/pay_ABC123/refund');

    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Refund-Idempotency']).toBe('refund-bkg1');

    vi.unstubAllGlobals();
  });
});
