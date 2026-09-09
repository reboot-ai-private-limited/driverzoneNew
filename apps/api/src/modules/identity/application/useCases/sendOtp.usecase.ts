import type { Role } from '@driverzone/contracts';
import {
  OTP_MAX_SENDS_PER_IP_PER_HOUR,
  OTP_MAX_SENDS_PER_PHONE_PER_HOUR,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  generateOtpCode,
  hashOtpCode,
} from '../../domain/otpChallenge.entity.js';
import { otpCooldownActive, otpSendLimitExceeded } from '../../domain/identity.errors.js';
import { AppError } from '@/shared/errors/AppError.js';
import type { AccountRepositoryPort } from '../../domain/account.repository.port.js';
import type { OtpSenderPort } from '../../domain/otpSender.port.js';
import type { OtpStorePort } from '../../domain/otpStore.port.js';

const HOUR_SECONDS = 3600;

export interface SendOtpInput {
  role: Role;
  phone: string;
  /** For the per-IP cap. Absent only if the request somehow arrived without one. */
  ip?: string | undefined;
}

export interface SendOtpResult {
  expiresInSeconds: number;
  retryAfterSeconds: number;
}

/**
 * APPLICATION — issue a login code.
 *
 * The single most important property of this use case is that **its result does not depend on
 * whether the number has an account.** Same body, same status, same timing class, every time.
 *
 * That matters most for `ADMIN`. If an unprovisioned number produced a different response, this
 * endpoint would be a directory of who works here — walk a number range, keep the 200s. So an
 * unknown admin number takes the identical path and simply never has an SMS dispatched; the
 * subsequent `verify` then fails with the ordinary "invalid or expired", because no challenge
 * was ever stored.
 */
export class SendOtpUseCase {
  constructor(
    private readonly store: OtpStorePort,
    private readonly sender: OtpSenderPort,
    private readonly accounts: AccountRepositoryPort,
    private readonly pepper: string,
  ) {}

  async execute(input: SendOtpInput): Promise<SendOtpResult> {
    const { role, phone } = input;

    // Cooldown first: it is the cheapest check and the one that most often fires, since a user
    // tapping "resend" early is ordinary behaviour rather than abuse.
    const cooldown = await this.store.cooldownRemaining(role, phone);
    if (cooldown > 0) throw otpCooldownActive(cooldown);

    const perPhone = await this.store.countSend('phone', `${role}:${phone}`, HOUR_SECONDS);
    if (perPhone.count > OTP_MAX_SENDS_PER_PHONE_PER_HOUR) {
      throw otpSendLimitExceeded(perPhone.ttlSeconds);
    }

    // The per-phone cap does nothing against one source walking a range of numbers, which is
    // what enumeration looks like. This is the cap that costs an attacker something.
    if (input.ip !== undefined && input.ip !== '') {
      const perIp = await this.store.countSend('ip', input.ip, HOUR_SECONDS);
      if (perIp.count > OTP_MAX_SENDS_PER_IP_PER_HOUR) {
        throw otpSendLimitExceeded(perIp.ttlSeconds);
      }
    }

    const account = await this.accounts.findByPhone(role, phone);

    if (account?.isBlocked) {
      throw AppError.forbidden('Your account has been suspended.');
    }

    /**
     * Admin accounts are never created by the auth flow (docs/LLD/auth.md §Admin provisioning),
     * so there is nothing to send to if the number is not already provisioned.
     *
     * Note what does NOT happen: no early return, no distinct error. The cooldown and counters
     * above were already spent, and the caller below receives exactly the same result it would
     * for a real admin. The only difference is that no SMS leaves the building.
     */
    const deliverable = role !== 'ADMIN' || account !== undefined;

    if (deliverable) {
      const code = generateOtpCode();
      await this.store.save(
        role,
        phone,
        { codeHash: hashOtpCode(code, this.pepper), attempts: 0 },
        OTP_TTL_SECONDS,
      );
      // Sending is the step that can fail for reasons outside this system. It happens after the
      // challenge is stored so that a provider timeout on a code that DID arrive still leaves a
      // verifiable challenge behind.
      await this.sender.send(role, phone, code);
    }

    await this.store.startCooldown(role, phone, OTP_RESEND_COOLDOWN_SECONDS);

    return {
      expiresInSeconds: OTP_TTL_SECONDS,
      retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    };
  }
}
