import type { OtpChannel, Role } from '@driverzone/contracts';
import { logger } from '@/shared/logging/logger.js';
import { AppError } from '@/shared/errors/AppError.js';
import type { OtpSenderPort } from '../domain/otpSender.port.js';

/**
 * INFRASTRUCTURE — the SMS OTP sender, through startmessaging.com's `/otp/send`.
 *
 * **IT SENDS OUR CODE, AND NEVER THEIR VERIFY ENDPOINT.** The provider offers a full OTP service:
 * `/otp/send` can mint its own code and `/otp/verify` validates it, with expiry and attempt
 * limits handled their side. We use exactly half of that. This system already generates the code
 * (`generateOtpCode`), stores only its HMAC under `OTP_PEPPER`, and checks it in `VerifyOtpUseCase`
 * with its own attempt ceiling — so adopting their verify would mean two sources of truth for one
 * login, two attempt counters that cannot agree, and a code whose validity depends on which of
 * the two answered. The code goes out in `variables.otp` and their `requestId` is discarded.
 *
 * **THE SECOND CHANNEL, NOT THE FIRST.** WhatsApp carries the OTP by default because it is free;
 * this runs when WhatsApp failed, or when the customer taps "Get code by SMS" because nothing
 * arrived. Every message here costs real money, which is why nothing reaches this class
 * automatically except a genuine delivery failure.
 *
 * It refuses to construct without its configuration, for the same reason `WhatsAppOtpSender` does:
 * a half-filled config should fail at boot rather than 500 on the first person trying to log in.
 */

export interface SmsOtpConfig {
  apiUrl: string;
  apiKey: string | undefined;
  templateId: string | undefined;
  /** Fills the template's `appName` variable — the sender name the customer reads in the SMS. */
  appName: string;
}

export class StartMessagingOtpSender implements OtpSenderPort {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly templateId: string;
  private readonly appName: string;

  constructor(
    config: SmsOtpConfig,
    private readonly timeoutMs: number = 10_000,
  ) {
    this.apiUrl = config.apiUrl;
    this.apiKey = demand(config.apiKey, 'SM_API_KEY');
    this.templateId = demand(config.templateId, 'SM_TEMPLATE_ID');
    this.appName = config.appName;
  }

  async send(role: Role, phone: string, code: string, _channel?: OtpChannel): Promise<void> {
    /*
     * E.164 WITH THE PLUS, exactly as the port hands it over — this provider's own examples read
     * `+919876543210`. No normalisation, deliberately: `WhatsAppOtpSender` strips the plus because
     * wabridge rejects it, and copying that here would silently send a number this API does not
     * recognise. The two gateways disagree, so each adapter owns its own spelling.
     */
    const payload = {
      phoneNumber: phone,
      templateId: this.templateId,
      variables: { otp: code, appName: this.appName },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}/otp/send`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Their own header, not a bearer token — see the provider's quickstart.
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      logger.error({ err: error, role }, 'sms gateway unreachable — login code not sent');
      throw AppError.internal('INTERNAL', { reason: 'Could not reach the SMS gateway' }, error);
    } finally {
      clearTimeout(timer);
    }

    /*
     * `null` on unparseable, rather than letting a throw escape: a 502 from a proxy in front of
     * the gateway is an HTML page, and crashing on the parse would turn a readable "the gateway
     * rejected it" into an unhandled SyntaxError with no status in the log.
     */
    const raw: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      logger.error(
        { role, status: response.status, gateway_response: raw },
        'sms gateway rejected the login code',
      );
      throw AppError.internal('INTERNAL', {
        reason: 'The SMS gateway rejected the message',
        status: response.status,
      });
    }

    // `role` only — `phone` and `code` are on the logger's redaction list, which is right here.
    logger.info({ role }, 'login code sent over SMS');
  }
}

/** Throws at construction, naming the variable, so a misconfigured prod deploy dies at boot. */
function demand(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw AppError.internal('INTERNAL', {
      reason: `StartMessagingOtpSender needs ${name} — set it, or do not configure the SMS channel`,
    });
  }
  return value;
}
