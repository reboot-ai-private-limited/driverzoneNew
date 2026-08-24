import type { Role } from '@driverzone/contracts';
import { isProduction } from '@/config/env.js';
import { logger } from '@/shared/logging/logger.js';
import { AppError } from '@/shared/errors/AppError.js';
import type { OtpSenderPort } from '../domain/otpSender.port.js';

/**
 * INFRASTRUCTURE — the development OTP "sender": it writes the code to the log.
 *
 * There is no SMS provider wired up yet. This adapter exists so the entire auth flow is testable
 * end to end today, and so the real one is a single swap in `identity.container.ts` when a
 * provider is chosen.
 *
 * **It refuses to run in production.** Not a warning, not a fallback — a hard fault at the point
 * of use. A misconfigured deploy that silently logged login codes instead of texting them would
 * look like "SMS is down" while writing live credentials to stdout, where the log pipeline keeps
 * them. Failing loudly makes that a five-minute diagnosis instead of a breach.
 */
export class LoggingOtpSender implements OtpSenderPort {
  send(role: Role, phone: string, code: string): Promise<void> {
    if (isProduction) {
      return Promise.reject(
        AppError.internal('INTERNAL', {
          reason: 'LoggingOtpSender must never run in production — no SMS provider is configured',
        }),
      );
    }

    /**
     * `otp` and `phone` are both in the logger's redaction list (`shared/logging/logger.ts`),
     * which is exactly right everywhere else and precisely wrong here — a redacted code cannot
     * be used to log in. The field names below deliberately dodge those paths, and this is the
     * one place in the codebase where that is the intent rather than a mistake.
     *
     * Safe only because of the production guard above.
     */
    logger.warn(
      { role, dev_recipient: phone, dev_login_code: code },
      'DEV ONLY — login code not sent by SMS, no provider configured',
    );
    return Promise.resolve();
  }
}
