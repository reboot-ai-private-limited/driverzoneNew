import { logger } from '@/shared/logging/logger.js';
import type { AccountMessagesPort } from '../domain/accountMessages.port.js';

/**
 * INFRASTRUCTURE — the account milestone messages, as waagent templates.
 *
 * Same gateway, key and sending number as `WaAgentOtpSender`; only the template differs. Each
 * template's shape is configuration for the same reason it is there: a variable key that does not
 * match the approved template is accepted with a 200 and never delivered. `GET /v1/templates`
 * reports the right key as `variables[].id` once Meta has approved the template.
 *
 * A template left unconfigured is skipped, so one message can go live before the other.
 */

export interface AccountTemplate {
  name: string;
  /** Exactly as approved — `en` and `en_US` are different templates. */
  languageCode: string;
  /** The key the recipient's name goes under. Unset for a template with no variables. */
  nameVariable: string | undefined;
}

export interface WaAgentAccountMessagesConfig {
  apiUrl: string;
  apiKey: string;
  phoneNumberId: string;
  welcomeCustomer: AccountTemplate | undefined;
  driverApproved: AccountTemplate | undefined;
}

/** What goes in the name slot when the account has none yet: "Hi there, welcome…". */
const NAME_FALLBACK = 'there';

export class WaAgentAccountMessages implements AccountMessagesPort {
  constructor(
    private readonly config: WaAgentAccountMessagesConfig,
    private readonly timeoutMs: number = 10_000,
  ) {}

  welcomeCustomer(phone: string, name: string | null): Promise<void> {
    return this.send('welcome_customer', this.config.welcomeCustomer, phone, name);
  }

  driverApproved(phone: string, name: string | null): Promise<void> {
    return this.send('driver_approved', this.config.driverApproved, phone, name);
  }

  private async send(
    kind: string,
    template: AccountTemplate | undefined,
    phone: string,
    name: string | null,
  ): Promise<void> {
    if (template === undefined) return;

    const variables: Record<string, string> = {};
    if (template.nameVariable !== undefined) {
      const trimmed = name?.trim() ?? '';
      variables[template.nameVariable] = trimmed === '' ? NAME_FALLBACK : trimmed;
    }

    const payload = {
      messaging_product: 'whatsapp',
      phone_number_id: this.config.phoneNumberId,
      to: phone,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.languageCode },
        variables,
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const raw: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        logger.warn(
          { kind, template: template.name, status: response.status, gateway_response: raw },
          'waagent rejected an account message',
        );
        return;
      }

      logger.info(
        { kind, template: template.name, message_id: messageIdOf(raw) },
        'account message sent over WhatsApp',
      );
    } catch (error) {
      logger.warn({ err: error, kind, template: template.name }, 'account message not sent');
    } finally {
      clearTimeout(timer);
    }
  }
}

function messageIdOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const body = raw as { messages?: unknown; message_id?: unknown };
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const id = (body.messages[0] as { id?: unknown }).id;
    if (typeof id === 'string' && id !== '') return id;
  }
  return typeof body.message_id === 'string' && body.message_id !== '' ? body.message_id : null;
}
