import type { Router } from 'express';
import type { Role } from '@driverzone/contracts';
import { env } from '@/config/env.js';
import { getRedis } from '@/shared/queue/redis.js';
import { TokenIssuer } from './application/tokenIssuer.js';
import { LogoutUseCase } from './application/useCases/logout.usecase.js';
import { RefreshSessionUseCase } from './application/useCases/refreshSession.usecase.js';
import { SendOtpUseCase } from './application/useCases/sendOtp.usecase.js';
import { VerifyOtpUseCase } from './application/useCases/verifyOtp.usecase.js';
import { MongoAccountRepository } from './infrastructure/account.repository.impl.js';
import { MongoSessionRepository } from './infrastructure/session.repository.impl.js';
import { LoggingOtpSender } from './infrastructure/otpSender.log.js';
import { RedisOtpStore } from './infrastructure/otpStore.redis.js';
import { makeAuthControllers } from './interface/auth.controller.js';
import { buildAuthRouter } from './interface/auth.routes.js';
import type { IdentityPublicContract } from './identity.public.js';

/**
 * THE COMPOSITION ROOT for this module — the one file allowed to name concrete classes.
 *
 * Swapping the development OTP sender for a real provider is one line here and nothing else:
 * `new LoggingOtpSender()` becomes `new Msg91OtpSender(...)`, and no use case, port or test
 * changes. That is the whole return on typing everything above against ports.
 */
export interface IdentityContainer {
  contract: IdentityPublicContract;

  /**
   * Builds the auth routes for ONE role.
   *
   * Health's convention is `buildRouter()` with no argument, and this deviates for a reason:
   * `identity` serves three role-scoped mount points rather than one, and the role must be fixed
   * at construction so no request can ask to be treated as a different one. Still a function
   * rather than an eager property, so the worker — which builds every container and serves no
   * HTTP — allocates no routers (docs/decision-log.md, 2026-08-22).
   */
  buildAuthRouter: (role: Role) => Router;
}

export function buildIdentityContainer(): IdentityContainer {
  // Redis is shared with BullMQ rather than a second connection: it is already configured with
  // `maxRetriesPerRequest: null` and one client multiplexes fine for these command volumes.
  const otpStore = new RedisOtpStore(getRedis());
  const otpSender = new LoggingOtpSender();
  const accounts = new MongoAccountRepository();
  const sessions = new MongoSessionRepository();

  const tokenIssuer = new TokenIssuer(sessions);

  // The pepper is read once, here, rather than inside the entity that uses it — that keeps
  // `otpChallenge.entity.ts` a pure function of its arguments and therefore testable with a
  // literal pepper and no environment at all.
  const sendOtp = new SendOtpUseCase(otpStore, otpSender, accounts, env.OTP_PEPPER);
  const verifyOtp = new VerifyOtpUseCase(otpStore, accounts, tokenIssuer, env.OTP_PEPPER);
  const refreshSession = new RefreshSessionUseCase(sessions, tokenIssuer);
  const logout = new LogoutUseCase(sessions);

  return {
    contract: {},
    buildAuthRouter: (role: Role) =>
      buildAuthRouter(role, makeAuthControllers(role, { sendOtp, verifyOtp, refreshSession, logout })),
  };
}
