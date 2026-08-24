import type { Role } from '@driverzone/contracts';

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
   */
  send(role: Role, phone: string, code: string): Promise<void>;
}
