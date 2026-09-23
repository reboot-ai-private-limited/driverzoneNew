import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/shared/errors/AppError.js';
import {
  WaAgentOtpSender,
  type WaAgentOtpConfig,
} from '../src/modules/identity/infrastructure/otpSender.waagent.js';
import { WaAgentDeliveryStatus } from '../src/modules/identity/infrastructure/waagentDeliveryStatus.js';

/**
 * The waagent WhatsApp sender, and the delivery check behind it.
 *
 * MOST OF THIS IS ABOUT THE TEMPLATE VARIABLES. Every other failure here is loud — a 4xx, a
 * timeout — but a template filled wrongly is accepted with a 200 and then silently not delivered,
 * which is indistinguishable from "WhatsApp is slow" until somebody cannot log in. So the exact
 * variable map each template shape produces is pinned.
 */

const CONFIG: WaAgentOtpConfig = {
  apiUrl: 'https://api.waagent.in/v1/messages',
  apiKey: 'wa-key',
  phoneNumberId: '973780053118608',
  template: '6ab230a3625321bab242628f',
  languageCode: 'en',
  codeVariable: 'code',
  contactVariable: undefined,
  contactNumber: '7044076603',
  buttonVariable: undefined,
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

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): {
  to: string;
  phone_number_id: string;
  template: { name: string; language: { code: string }; variables: Record<string, string> };
} {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body));
}

describe('WaAgentOtpSender — construction', () => {
  it('refuses to construct with any of its three required fields missing', () => {
    expect(() => new WaAgentOtpSender({ ...CONFIG, apiKey: undefined })).toThrow(AppError);
    expect(() => new WaAgentOtpSender({ ...CONFIG, phoneNumberId: undefined })).toThrow(AppError);
    expect(() => new WaAgentOtpSender({ ...CONFIG, template: undefined })).toThrow(AppError);
  });
});

describe('WaAgentOtpSender — the template payload', () => {
  it('sends the code under the token the template declared, and nothing else', async () => {
    const fetchMock = stubFetch(() => ok({ messages: [{ id: 'wamid.ABC' }] }));

    await new WaAgentOtpSender(CONFIG).send('CUSTOMER', '+919876543210', '483920');

    const body = bodyOf(fetchMock);
    expect(body.template.variables).toEqual({ code: '483920' });
    expect(body.template.name).toBe('6ab230a3625321bab242628f');
    expect(body.phone_number_id).toBe('973780053118608');
    // THE PLUS SURVIVES, unlike the wabridge adapter which strips it — the two gateways disagree.
    expect(body.to).toBe('+919876543210');
  });

  it('adds the contact number under its own key when the template has one', async () => {
    const fetchMock = stubFetch(() => ok({ messages: [{ id: 'wamid.ABC' }] }));

    await new WaAgentOtpSender({ ...CONFIG, contactVariable: 'contact' }).send(
      'CUSTOMER',
      '+919876543210',
      '483920',
    );

    expect(bodyOf(fetchMock).template.variables).toEqual({
      code: '483920',
      contact: '7044076603',
    });
  });

  /*
   * An authentication template's copy-code button is filled from its own variable. Filling only
   * the body is refused at 422, or delivered with a button that does nothing.
   */
  it('repeats the code into the button variable when the template has a button', async () => {
    const fetchMock = stubFetch(() => ok({ messages: [{ id: 'wamid.ABC' }] }));

    await new WaAgentOtpSender({ ...CONFIG, buttonVariable: 'button.0.1' }).send(
      'CUSTOMER',
      '+919876543210',
      '483920',
    );

    expect(bodyOf(fetchMock).template.variables).toEqual({
      code: '483920',
      'button.0.1': '483920',
    });
  });

  it('authenticates with a bearer token', async () => {
    const fetchMock = stubFetch(() => ok({ messages: [{ id: 'wamid.ABC' }] }));
    await new WaAgentOtpSender(CONFIG).send('CUSTOMER', '+919876543210', '483920');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer wa-key');
  });
});

describe('WaAgentOtpSender — failure and the delivery hook', () => {
  it('rejects on a non-2xx, and on an unparseable body', async () => {
    stubFetch(() => Promise.resolve(new Response('{"error":{"code":"BAD"}}', { status: 400 })));
    await expect(
      new WaAgentOtpSender(CONFIG).send('CUSTOMER', '+919876543210', '483920'),
    ).rejects.toBeInstanceOf(AppError);

    stubFetch(() => Promise.resolve(new Response('<html>502</html>', { status: 502 })));
    await expect(
      new WaAgentOtpSender(CONFIG).send('CUSTOMER', '+919876543210', '483920'),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects when the gateway is unreachable', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(
      new WaAgentOtpSender(CONFIG).send('CUSTOMER', '+919876543210', '483920'),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('hands the message id to onSent so delivery can be checked', async () => {
    stubFetch(() => ok({ messages: [{ id: 'wamid.HBgMOTE5' }] }));
    const seen: string[] = [];

    await new WaAgentOtpSender({ ...CONFIG, onSent: (h) => seen.push(h.messageId) }).send(
      'CUSTOMER',
      '+919876543210',
      '483920',
    );

    expect(seen).toEqual(['wamid.HBgMOTE5']);
  });

  /*
   * The message DID go out. A scheduling failure must not turn that into a 500 that tells the
   * customer to try again — they would be sent a second code for no reason.
   */
  it('still resolves when the delivery hook throws', async () => {
    stubFetch(() => ok({ messages: [{ id: 'wamid.ABC' }] }));
    const sender = new WaAgentOtpSender({
      ...CONFIG,
      onSent: () => {
        throw new Error('redis down');
      },
    });

    await expect(sender.send('CUSTOMER', '+919876543210', '483920')).resolves.toBeUndefined();
  });

  it('resolves without calling the hook when the response carries no message id', async () => {
    stubFetch(() => ok({ accepted: true }));
    const seen: string[] = [];

    await new WaAgentOtpSender({ ...CONFIG, onSent: (h) => seen.push(h.messageId) }).send(
      'CUSTOMER',
      '+919876543210',
      '483920',
    );

    expect(seen).toEqual([]);
  });
});

describe('WaAgentDeliveryStatus', () => {
  const status = (): WaAgentDeliveryStatus =>
    new WaAgentDeliveryStatus({ apiUrl: 'https://api.waagent.in/v1/messages', apiKey: 'wa-key' });

  it('counts delivered and read as arrived', async () => {
    stubFetch(() => ok({ status: 'delivered' }));
    await expect(status().check('wamid.ABC')).resolves.toBe('arrived');

    stubFetch(() => ok({ status: 'read' }));
    await expect(status().check('wamid.ABC')).resolves.toBe('arrived');
  });

  /*
   * Both mean WhatsApp has it and the handset does not — after the job's delay, that is a phone
   * that is off or has no WhatsApp, which is exactly what the SMS fallback is for.
   */
  it('counts queued, sent and failed as not arrived', async () => {
    for (const s of ['queued', 'sent', 'failed']) {
      stubFetch(() => ok({ status: s }));
      await expect(status().check('wamid.ABC')).resolves.toBe('not-arrived');
    }
  });

  /* The send handed us this id seconds ago; the account not knowing it is an answer. */
  it('treats a 404 as not arrived', async () => {
    stubFetch(() => Promise.resolve(new Response('{}', { status: 404 })));
    await expect(status().check('wamid.ABC')).resolves.toBe('not-arrived');
  });

  /*
   * NOT EVIDENCE ABOUT THE MESSAGE. Spending an SMS on every rate-limited or unauthorised check
   * would turn a bad API key into a bill, so these answer `null` and nothing is sent.
   */
  it('answers null when the check itself cannot be made', async () => {
    for (const code of [401, 403, 429, 500]) {
      stubFetch(() => Promise.resolve(new Response('{}', { status: code })));
      await expect(status().check('wamid.ABC')).resolves.toBeNull();
    }

    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(status().check('wamid.ABC')).resolves.toBeNull();

    stubFetch(() => ok({ nothing: 'useful' }));
    await expect(status().check('wamid.ABC')).resolves.toBeNull();
  });

  it('escapes the id into the path', async () => {
    const fetchMock = stubFetch(() => ok({ status: 'delivered' }));
    await status().check('wamid.HBgM/OTE5+A==');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.waagent.in/v1/messages/${encodeURIComponent('wamid.HBgM/OTE5+A==')}`,
    );
  });
});
