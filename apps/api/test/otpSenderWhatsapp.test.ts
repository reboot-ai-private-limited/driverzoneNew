import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/shared/errors/AppError.js';
import {
  WhatsAppOtpSender,
  type WhatsAppOtpConfig,
} from '../src/modules/identity/infrastructure/otpSender.whatsapp.js';

/**
 * The production OTP sender.
 *
 * The point of the tests is the FAILURE shape: a login channel that breaks must reject so the
 * use case turns it into a 500, never resolve while the code goes nowhere. And the config guard
 * must fire at construction, because "the deploy did not boot" is a far cheaper discovery than
 * "nobody can log in".
 */

const CONFIG: WhatsAppOtpConfig = {
  apiUrl: 'https://web.wabridge.com/api/createmessage',
  appKey: 'app-key',
  authKey: 'auth-key',
  deviceId: 'device-id',
  templateId: 'template-id',
  contactNumber: '7044076603',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const ok = (payload: unknown): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));

describe('WhatsAppOtpSender — construction', () => {
  it.each(['appKey', 'authKey', 'deviceId', 'templateId', 'contactNumber'] as const)(
    'throws when %s is missing, naming the variable',
    (field) => {
      expect(
        () => new WhatsAppOtpSender({ ...CONFIG, [field]: undefined as unknown as string }),
      ).toThrow(AppError);
    },
  );

  it('constructs when every field is present', () => {
    expect(() => new WhatsAppOtpSender(CONFIG)).not.toThrow();
  });
});

describe('WhatsAppOtpSender — send', () => {
  it('posts a JSON template payload with hyphenated key fields to the configured URL', async () => {
    const fetchMock = stubFetch(() => ok({ status: true, message: 'Message submited successfully' }));

    await new WhatsAppOtpSender(CONFIG).send('DRIVER', '+919876543210', '123456');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CONFIG.apiUrl);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['template_id']).toBe('template-id');
    // E.164 in, bare digits out under the field wabridge actually checks for.
    expect(body['destination_number']).toBe('919876543210');
    // {{1}} = code, {{2}} = contact number. Both, or WhatsApp drops the message.
    expect(body['variables']).toEqual(['123456', '7044076603']);
    // Hyphens, not underscores — underscored keys get "not enough permission".
    expect(body['app-key']).toBe('app-key');
    expect(body['auth-key']).toBe('auth-key');
    expect(body['language']).toBe('en');
  });

  it('resolves only on status:true', async () => {
    stubFetch(() => ok({ status: true }));
    await expect(
      new WhatsAppOtpSender(CONFIG).send('CUSTOMER', '+919876543210', '000111'),
    ).resolves.toBeUndefined();
  });

  it('rejects when wabridge answers status:false', async () => {
    stubFetch(() => ok({ status: false, message: 'Destination Number is required!' }));
    await expect(
      new WhatsAppOtpSender(CONFIG).send('CUSTOMER', '+919876543210', '000111'),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects on a non-2xx response', async () => {
    stubFetch(() => Promise.resolve(new Response('nope', { status: 502 })));
    await expect(
      new WhatsAppOtpSender(CONFIG).send('DRIVER', '+919876543210', '123456'),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects when the gateway is unreachable', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(
      new WhatsAppOtpSender(CONFIG).send('DRIVER', '+919876543210', '123456'),
    ).rejects.toBeInstanceOf(AppError);
  });
});
