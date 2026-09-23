import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OtpSenderPort } from '../src/modules/identity/domain/otpSender.port.js';
import { AppError } from '../src/shared/errors/AppError.js';
import {
  StartMessagingOtpSender,
  type SmsOtpConfig,
} from '../src/modules/identity/infrastructure/otpSender.startmessaging.js';
import { WhatsAppFirstOtpSender } from '../src/modules/identity/infrastructure/otpSender.whatsAppFirst.js';

/**
 * The SMS channel and the composite that decides when to reach for it.
 *
 * The composite's tests are the ones that matter: every message through this channel costs money,
 * so "SMS was not sent when WhatsApp worked" is as much a requirement as "SMS was sent when it
 * did not".
 */

const CONFIG: SmsOtpConfig = {
  apiUrl: 'https://api.startmessaging.com',
  apiKey: 'sm_live_key',
  templateId: 'template-id',
  appName: 'DriverZone',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(
  impl: (url: string, init: RequestInit) => Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const ok = (payload: unknown): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));

describe('StartMessagingOtpSender — construction', () => {
  it('refuses to construct without the key or the template', () => {
    expect(() => new StartMessagingOtpSender({ ...CONFIG, apiKey: undefined })).toThrow(AppError);
    expect(() => new StartMessagingOtpSender({ ...CONFIG, templateId: undefined })).toThrow(
      AppError,
    );
  });
});

describe('StartMessagingOtpSender — send', () => {
  it('posts our own code to /otp/send with the X-API-Key header', async () => {
    const fetchMock = stubFetch(() => ok({ requestId: 'ignored-by-design' }));

    await new StartMessagingOtpSender(CONFIG).send('CUSTOMER', '+919876543210', '483920');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.startmessaging.com/otp/send');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('sm_live_key');

    const body = JSON.parse(String(init.body)) as {
      phoneNumber: string;
      templateId: string;
      variables: { otp: string; appName: string };
    };
    // THE PLUS SURVIVES — this gateway wants E.164 as-is, unlike wabridge, which is why the
    // adapter does no normalisation of its own.
    expect(body.phoneNumber).toBe('+919876543210');
    expect(body.templateId).toBe('template-id');
    // OUR code, not one the provider minted: verification happens here, against the stored HMAC.
    expect(body.variables.otp).toBe('483920');
    expect(body.variables.appName).toBe('DriverZone');
  });

  it('rejects on a non-2xx response', async () => {
    stubFetch(() => Promise.resolve(new Response('{"error":"bad template"}', { status: 400 })));
    await expect(
      new StartMessagingOtpSender(CONFIG).send('CUSTOMER', '+919876543210', '483920'),
    ).rejects.toBeInstanceOf(AppError);
  });

  /* A proxy's HTML error page must read as "the gateway rejected it", not an unhandled parse. */
  it('rejects on a non-2xx response that is not even JSON', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>502</html>', { status: 502 })));
    await expect(
      new StartMessagingOtpSender(CONFIG).send('CUSTOMER', '+919876543210', '483920'),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects when the gateway is unreachable', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(
      new StartMessagingOtpSender(CONFIG).send('CUSTOMER', '+919876543210', '483920'),
    ).rejects.toBeInstanceOf(AppError);
  });
});

/** Records what it was asked to do, and fails on demand. */
function spySender(failing = false): OtpSenderPort & { calls: (string | undefined)[] } {
  const calls: (string | undefined)[] = [];
  return {
    calls,
    send: (_role, _phone, _code, channel) => {
      calls.push(channel);
      return failing
        ? Promise.reject(new AppError('INTERNAL', 'gateway down', 500))
        : Promise.resolve();
    },
  };
}

describe('WhatsAppFirstOtpSender', () => {
  it('uses WhatsApp only, and never spends an SMS, when WhatsApp works', async () => {
    const wa = spySender();
    const sms = spySender();

    await new WhatsAppFirstOtpSender(wa, sms).send('CUSTOMER', '+919876543210', '483920');

    expect(wa.calls).toHaveLength(1);
    expect(sms.calls).toHaveLength(0);
  });

  it('falls back to SMS when the WhatsApp gateway rejects', async () => {
    const wa = spySender(true);
    const sms = spySender();

    await new WhatsAppFirstOtpSender(wa, sms).send('CUSTOMER', '+919876543210', '483920');

    expect(wa.calls).toHaveLength(1);
    expect(sms.calls).toEqual(['SMS']);
  });

  /*
   * The customer has already told us WhatsApp did not reach them. Trying it again would spend a
   * send against their hourly cap and make them wait out a second failure.
   */
  it('skips WhatsApp entirely when SMS is explicitly requested', async () => {
    const wa = spySender();
    const sms = spySender();

    await new WhatsAppFirstOtpSender(wa, sms).send('CUSTOMER', '+919876543210', '483920', 'SMS');

    expect(wa.calls).toHaveLength(0);
    expect(sms.calls).toEqual(['SMS']);
  });

  it('rejects when both channels fail, so the use case can answer honestly', async () => {
    const sender = new WhatsAppFirstOtpSender(spySender(true), spySender(true));
    await expect(sender.send('CUSTOMER', '+919876543210', '483920')).rejects.toBeInstanceOf(
      AppError,
    );
  });
});
