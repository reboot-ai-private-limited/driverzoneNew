import type { OtpChannel, Role } from '@driverzone/contracts';

/**
 * PORT — delivering a code to a phone, without naming a telecom.
 *
 * There is no SMS provider in this repository yet; `otpSender.log.ts` is a development adapter
 * that writes the code to the log. Swapping in MSG91, Twilio or anything else is one new class
 * and one line in `identity.container.ts` — the use cases never learn that anything changed.
 *
 * `role` is passed because the message copy legitimately differs ("your DriverZone driver login
 * code"), and because delivery routing may eventually differ per role — transactional versus
 * promotional SMS routes have different regulatory treatment in India.
 */
export interface OtpSenderPort {
  /**
   * Deliver `code` to `phone`.
   *
   * **May reject.** A telecom outage is a fault, not a client error, and the caller turns a
   * rejection into a 500 rather than pretending the code was sent — a user staring at a code
   * that will never arrive is worse than an honest failure.
   *
   * `channel` IS A REQUEST, NOT A GUARANTEE, and every adapter is free to ignore it. It exists
   * because the customer can say "it never reached my WhatsApp" and ask for an SMS instead; a
   * composite sender routes on it, while a single-channel adapter has only one thing it can do
   * and does that. The alternative — refusing to send at all because the configured provider is
   * not the one asked for — would strand somebody trying to log in over a deployment detail.
   *
   * Undefined means the default route, which is what every caller before this field sent.
   */
  send(role: Role, phone: string, code: string, channel?: OtpChannel): Promise<void>;
}
