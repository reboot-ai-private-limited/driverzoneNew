import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WaAgentAccountMessages,
  type WaAgentAccountMessagesConfig,
} from '../src/modules/identity/infrastructure/accountMessages.waagent.js';

const CONFIG: WaAgentAccountMessagesConfig = {
  apiUrl: 'https://api.waagent.in/v1/messages',
  apiKey: 'wa-key',
  phoneNumberId: '973780053118608',
  welcomeCustomer: { name: 'welcome_customer', languageCode: 'en', nameVariable: undefined },
  driverApproved: { name: 'driver_approval', languageCode: 'en', nameVariable: 'name' },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const ok = (): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 }));

function bodyOf(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as {
    to: string;
    phone_number_id: string;
    template: { name: string; language: { code: string }; variables: Record<string, string> };
  };
}

describe('WaAgentAccountMessages', () => {
  it('sends the welcome template with no variables when it declares none', async () => {
    const fetchMock = stubFetch(ok);
    await new WaAgentAccountMessages(CONFIG).welcomeCustomer('+919832349168', null);

    const body = bodyOf(fetchMock);
    expect(body.to).toBe('+919832349168');
    expect(body.phone_number_id).toBe('973780053118608');
    expect(body.template).toEqual({ name: 'welcome_customer', language: { code: 'en' }, variables: {} });
  });

  it('fills the name under the template’s own key, with a fallback when there is none', async () => {
    let fetchMock = stubFetch(ok);
    await new WaAgentAccountMessages(CONFIG).driverApproved('+919832349168', 'Ravi Kumar');
    expect(bodyOf(fetchMock).template.variables).toEqual({ name: 'Ravi Kumar' });

    fetchMock = stubFetch(ok);
    await new WaAgentAccountMessages(CONFIG).driverApproved('+919832349168', '  ');
    expect(bodyOf(fetchMock).template.variables).toEqual({ name: 'there' });
  });

  it('skips a template that is not configured', async () => {
    const fetchMock = stubFetch(ok);
    await new WaAgentAccountMessages({ ...CONFIG, welcomeCustomer: undefined }).welcomeCustomer(
      '+919832349168',
      null,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /* The port never rejects: a sign-in or an approval must not fail because WhatsApp did. */
  it('resolves on a rejection and when the gateway is unreachable', async () => {
    stubFetch(() => Promise.resolve(new Response('{"error":{"code":"TEMPLATE_NOT_FOUND"}}', { status: 404 })));
    await expect(new WaAgentAccountMessages(CONFIG).welcomeCustomer('+91', null)).resolves.toBeUndefined();

    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(new WaAgentAccountMessages(CONFIG).driverApproved('+91', 'A')).resolves.toBeUndefined();
  });
});
