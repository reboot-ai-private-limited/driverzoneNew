import type { OtpChannel, Role } from '@driverzone/contracts';
import {
  OTP_MAX_SENDS_PER_IP_PER_HOUR,
  OTP_MAX_SENDS_PER_PHONE_PER_HOUR,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  generateOtpCode,
  hashOtpCode,
  type OtpPurpose,
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
  /**
   * Which route the caller asked for. Absent is the default, which is what every caller sent
   * before the field existed.
   *
   * `SMS` ALSO SKIPS THE RESEND COOLDOWN — see the cooldown check below for why that is the only
   * version of this feature that is worth having.
   */
  channel?: OtpChannel | undefined;
  /**
   * What the code is for. Absent is `LOGIN`, which is every caller that existed before deletion.
   * A `DELETE_ACCOUNT` code lives in its own slot and can only be spent by the deletion flow.
   */
  purpose?: OtpPurpose | undefined;
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
    /** The demo customer number (`REVIEW_LOGIN_PHONE`): no code is generated or sent for it. */
    private readonly reviewPhone?: string | undefined,
  ) {}

  async execute(input: SendOtpInput): Promise<SendOtpResult> {
    const { role, phone } = input;
    const purpose = input.purpose ?? 'LOGIN';

    /*
     * Cooldown first: it is the cheapest check and the one that most often fires, since a user
     * tapping "resend" early is ordinary behaviour rather than abuse.
     *
     * **AN EXPLICIT SMS REQUEST IS EXEMPT, AND THAT IS THE WHOLE FEATURE.** "Get code by SMS"
     * exists for the customer whose WhatsApp message never arrived, and that is exactly the
     * moment the cooldown from that failed send is still running. Enforcing it here would show
     * them a countdown instead of the code — the button would be decorative, and they would be
     * stuck until it lapsed on a message that was never coming.
     *
     * THE HOURLY CAPS BELOW ARE NOT SKIPPED, and they are the real defence. Five sends per phone
     * and ten per IP still bound this at a handful of messages an hour for any one number, so
     * the exemption cannot be turned into a way to spend the SMS wallet or hammer somebody
     * else's handset. The cooldown was pacing a human; the caps stop a machine.
     */
    const cooldown = await this.store.cooldownRemaining(role, phone, purpose);
    if (cooldown > 0 && input.channel !== 'SMS') throw otpCooldownActive(cooldown);

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

    // Only LOGIN is refused. A suspended user may still close their account: being suspended is
    // not a reason to keep somebody's personal data against their wishes.
    if (purpose === 'LOGIN' && account?.isBlocked) {
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
    const deliverable =
      purpose === 'DELETE_ACCOUNT'
        ? // Nothing to close, so nothing to send — same silent path as an unknown admin number, so the
          // deletion form cannot be walked to learn which numbers have accounts.
          account !== undefined && role !== 'ADMIN'
        : role !== 'ADMIN' || account !== undefined;

    // The demo number signs in with its fixed code (VerifyOtpUseCase), so a real code would only
    // spend an SMS on a number nobody holds. Everything around it — cooldown, caps — still runs.
    const isReviewNumber =
      role === 'CUSTOMER' && this.reviewPhone !== undefined && phone === this.reviewPhone;

    if (deliverable && !isReviewNumber) {
      const code = generateOtpCode();
      await this.store.save(
        role,
        phone,
        { codeHash: hashOtpCode(code, this.pepper), attempts: 0 },
        OTP_TTL_SECONDS,
        purpose,
      );
      // Sending is the step that can fail for reasons outside this system. It happens after the
      // challenge is stored so that a provider timeout on a code that DID arrive still leaves a
      // verifiable challenge behind.
      await this.sender.send(role, phone, code, input.channel);
    }

    await this.store.startCooldown(role, phone, OTP_RESEND_COOLDOWN_SECONDS, purpose);

    return {
      expiresInSeconds: OTP_TTL_SECONDS,
      retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    };
  }
}
