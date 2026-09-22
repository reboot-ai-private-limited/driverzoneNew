import { logger } from '@/shared/logging/logger.js';

/**
 * INFRASTRUCTURE — "did that WhatsApp message actually arrive?", asked of waagent.
 *
 * `GET /v1/messages/{id}` reports one message's state. It moves forward only —
 * `queued → sent → delivered → read`, or `failed` — so a late webhook cannot walk a verdict back,
 * and a single read at the right moment is enough to decide.
 *
 * THIS EXISTS BECAUSE ACCEPTED IS NOT DELIVERED. A send returns 200 when the gateway has taken
 * the message; a number with no WhatsApp account, or a template mismatch, fails silently after
 * that point. Without this check the SMS fallback could only ever catch gateway outages, which
 * are the rarer half of the problem.
 */

/** Anything that is not a confirmed arrival. `null` means the question could not be answered. */
export type WaDeliveryVerdict = 'arrived' | 'not-arrived' | null;

export interface WaAgentStatusConfig {
  /** The messages collection, e.g. `https://api.waagent.in/v1/messages`. */
  apiUrl: string;
  apiKey: string;
}

export class WaAgentDeliveryStatus {
  constructor(
    private readonly config: WaAgentStatusConfig,
    private readonly timeoutMs: number = 8_000,
  ) {}

  /**
   * Whether the message reached the handset.
   *
   * **`queued` AND `sent` COUNT AS NOT ARRIVED**, once the caller has already waited. Both mean
   * WhatsApp has the message and the device does not, which after ten seconds is a phone that is
   * off, has no WhatsApp, or is not coming back soon — the cases the SMS fallback is for. The
   * cost of being wrong is one duplicate message carrying the same code, which is harmless; the
   * cost of the opposite mistake is a customer who cannot log in at all.
   *
   * **AN UNANSWERABLE CHECK RETURNS `null`, NOT "not arrived".** A 401, a 429, an outage — none
   * of those are evidence about the message, and spending an SMS on every one of them would turn
   * a bad API key into a bill. The caller leaves the message alone; the customer still has the
   * "Get code by SMS" button.
   */
  async check(messageId: string): Promise<WaDeliveryVerdict> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.config.apiUrl}/${encodeURIComponent(messageId)}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.config.apiKey}` },
        signal: controller.signal,
      });
    } catch (error) {
      logger.warn({ err: error }, 'waagent delivery check unreachable');
      return null;
    } finally {
      clearTimeout(timer);
    }

    const raw: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      /*
       * 404 IS THE ONE FAILURE THAT IS AN ANSWER. The send handed us this id moments ago, so the
       * account not knowing it means the message is not in flight anywhere — treat it as not
       * arrived. Every other status is a problem with the request or the gateway.
       */
      if (response.status === 404) return 'not-arrived';
      logger.warn({ status: response.status }, 'waagent delivery check refused');
      return null;
    }

    const status = statusOf(raw);
    if (status === null) {
      logger.warn({ body: raw }, 'waagent delivery check returned no readable status');
      return null;
    }

    return status === 'delivered' || status === 'read' ? 'arrived' : 'not-arrived';
  }
}

function statusOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const body = raw as { status?: unknown; data?: { status?: unknown } };
  if (typeof body.status === 'string') return body.status.toLowerCase();
  if (typeof body.data?.status === 'string') return body.data.status.toLowerCase();
  return null;
}
