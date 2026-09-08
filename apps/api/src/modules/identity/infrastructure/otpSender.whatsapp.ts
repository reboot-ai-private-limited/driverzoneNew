import type { Role } from '@driverzone/contracts';
import { logger } from '@/shared/logging/logger.js';
import { AppError } from '@/shared/errors/AppError.js';
import type { OtpSenderPort } from '../domain/otpSender.port.js';

/**
 * INFRASTRUCTURE — the production OTP sender. Delivers the login code over WhatsApp through
 * wabridge.com's `createmessage` endpoint.
 *
 * **Template, not free text.** A business-initiated WhatsApp message to a user who is not inside
 * a 24-hour session window MUST be a pre-approved template — a plain-text body is silently
 * dropped by WhatsApp. `WA_TEMPLATE_ID` names a template whose single variable is the code.
 *
 * **It refuses to construct without its configuration.** The container wires this whenever all
 * four WA_* keys are set (see `identity.container.ts`); the constructor still throws if one is
 * blank, so a half-filled config fails at boot rather than 500ing on the first person who tries
 * to log in. Same "be loud" stance as `LoggingOtpSender` refusing to run in production.
 *
 * **`send` may reject**, per `OtpSenderPort`: a wabridge outage is a fault, and the use case
 * turns the rejection into a 500 rather than telling the caller a code is on its way that is not.
 */

export interface WhatsAppOtpConfig {
  apiUrl: string;
  appKey: string | undefined;
  authKey: string | undefined;
  deviceId: string | undefined;
  templateId: string | undefined;
  /** Fills the template's `{{2}}` — the "contact us" number shown beside the code. */
  contactNumber: string;
}

export class WhatsAppOtpSender implements OtpSenderPort {
  private readonly apiUrl: string;
  private readonly appKey: string;
  private readonly authKey: string;
  private readonly deviceId: string;
  private readonly templateId: string;
  private readonly contactNumber: string;

  constructor(
    config: WhatsAppOtpConfig,
    private readonly timeoutMs: number = 10_000,
  ) {
    this.apiUrl = config.apiUrl;
    this.appKey = demand(config.appKey, 'WA_APP_KEY');
    this.authKey = demand(config.authKey, 'WA_AUTH_KEY');
    this.deviceId = demand(config.deviceId, 'WA_DEVICE_ID');
    this.templateId = demand(config.templateId, 'WA_TEMPLATE_ID');
    this.contactNumber = demand(config.contactNumber, 'WA_OTP_CONTACT_NUMBER');
  }

  async send(role: Role, phone: string, code: string): Promise<void> {
    /*
     * wabridge wants a bare country+national string — `919876543210`, no `+`, no spaces. The
     * port is handed E.164, so this is the one normalisation between the two.
     */
    const destinationNumber = phone.replace(/[^\d]/g, '');

    /*
     * JSON body, and the key fields are HYPHENATED — `app-key` / `auth-key`, not underscores.
     * Both were established by probing the live endpoint: form-encoded or underscored keys come
     * back "You don't have enough permission to perform this action!".
     *
     * `variables` fills the template's placeholders in order: `{{1}}` the code, `{{2}}` the
     * contact number. The template has BOTH — sending only the code returns `status: true` but
     * WhatsApp never delivers the message.
     */
    const payload = {
      'app-key': this.appKey,
      'auth-key': this.authKey,
      device_id: this.deviceId,
      template_id: this.templateId,
      destination_number: destinationNumber,
      language: 'en',
      variables: [code, this.contactNumber],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      logger.error({ err: error, role }, 'wabridge unreachable — login code not sent');
      throw AppError.internal(
        'INTERNAL',
        { reason: 'Could not reach the WhatsApp gateway' },
        error,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw: unknown = await response.json().catch(() => null);

    if (!response.ok || !isAccepted(raw)) {
      logger.error(
        { role, status: response.status, gateway_response: raw },
        'wabridge rejected the login code',
      );
      throw AppError.internal('INTERNAL', {
        reason: 'The WhatsApp gateway rejected the message',
        status: response.status,
      });
    }

    // `role` only — `phone` and `code` are on the logger's redaction list, which is right here.
    logger.info({ role }, 'login code sent over WhatsApp');
  }
}

/** wabridge answers `{ status: boolean, message: string }`; `status: true` is the only success. */
function isAccepted(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && (raw as { status?: unknown }).status === true;
}

/** Throws at construction, naming the variable, so a misconfigured prod deploy dies at boot. */
function demand(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw AppError.internal('INTERNAL', {
      reason: `WhatsAppOtpSender needs ${name} — set it, or this process must not run in production`,
    });
  }
  return value;
}
