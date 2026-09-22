import type { OtpChannel, Role } from '@driverzone/contracts';
import { logger } from '@/shared/logging/logger.js';
import type { OtpSenderPort } from '../domain/otpSender.port.js';

/**
 * INFRASTRUCTURE — WhatsApp with SMS behind it, as one `OtpSenderPort`.
 *
 * A DECORATOR, so nothing above it learns there are two providers. `SendOtpUseCase` still holds a
 * single sender, still awaits one call, and still turns a rejection into a 500 — the composition
 * is a wiring decision made in the container, which is where every other provider choice is made.
 *
 * **WHY WHATSAPP FIRST: it is free and SMS is not.** Every message through the second channel
 * costs real money, so nothing reaches it except a genuine failure or a customer explicitly
 * asking. The order is not a quality judgement about the two gateways.
 *
 * **WHAT THIS CAN AND CANNOT CATCH.** It falls back when the WhatsApp gateway *rejects* — a
 * non-2xx, a timeout, an unreachable host. It cannot catch the more common silent failure, where
 * the gateway accepts the message and WhatsApp never delivers it, because the number has no
 * WhatsApp account or the template is wrong. Those return success and this sees nothing wrong.
 * Closing that gap needs the delivery-status check (`GET /v1/messages/{id}`) or a provider
 * webhook, which is why the "Get code by SMS" control exists on the OTP screen: until the
 * delivery check is wired, the customer is the only detector of a silent failure.
 *
 * **BOTH FAILING RE-THROWS THE SMS ERROR, not the WhatsApp one.** The second failure is the more
 * recent and the more actionable — the WhatsApp one is already logged in full below, and a caller
 * that sees "could not reach the SMS gateway" is being told the last thing that was tried.
 */
export class WhatsAppFirstOtpSender implements OtpSenderPort {
  constructor(
    private readonly whatsapp: OtpSenderPort,
    private readonly sms: OtpSenderPort,
  ) {}

  async send(role: Role, phone: string, code: string, channel?: OtpChannel): Promise<void> {
    /*
     * AN EXPLICIT SMS REQUEST SKIPS WHATSAPP ENTIRELY, rather than trying it first and falling
     * back. The customer tapping "Get code by SMS" has already told us the one useful fact about
     * this attempt: WhatsApp did not work for them. Trying it again would spend another send
     * against their hourly cap, make them wait out a second timeout, and most likely fail the
     * same silent way — while the SMS they asked for sits behind it.
     */
    if (channel === 'SMS') {
      await this.sms.send(role, phone, code, channel);
      return;
    }

    try {
      await this.whatsapp.send(role, phone, code, channel);
    } catch (error) {
      /*
       * WARN, not ERROR: the login is not lost yet, and the adapter that failed has already
       * logged the gateway's own status and body at error level. A second error line here would
       * double-count one failure in the dashboards.
       */
      logger.warn({ err: error, role }, 'whatsapp otp failed — falling back to sms');
      await this.sms.send(role, phone, code, 'SMS');
      logger.info({ role }, 'login code delivered by sms fallback');
    }
  }
}
