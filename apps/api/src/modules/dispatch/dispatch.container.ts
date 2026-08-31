import type { Router } from 'express';
import type { BookingDispatchContract } from '../bookings/bookings.public.js';
import type { NotificationsContract } from '../notifications/notifications.public.js';
import type { SettingsReadContract } from '../settings/settings.public.js';
import { MongoOfferRepository } from './infrastructure/offerRepository.impl.js';
import { MongoDriverPool } from './infrastructure/mongoDriverPool.js';
import {
  ExpireWaveUseCase,
  RunDispatchWaveUseCase,
  type WaveTimeoutScheduler,
} from './application/useCases/runWave.usecase.js';
import {
  AcceptOfferUseCase,
  DeclineOfferUseCase,
} from './application/useCases/respondToOffer.usecase.js';
import {
  makeAcceptOfferController,
  makeCurrentOfferController,
  makeDeclineOfferController,
} from './interface/dispatch.controller.js';
import { buildDriverRouter } from './interface/dispatch.routes.js';

export interface DispatchDependencies {
  bookings: BookingDispatchContract;
  settings: SettingsReadContract;
  notifications: NotificationsContract;
  /**
   * Enqueues the wave timeout. BullMQ, never a `setTimeout` — an in-memory timer dies on deploy,
   * and a booking whose timeout died is the "silently hangs with no driver" failure this whole
   * module exists to prevent.
   */
  scheduleWaveTimeout: WaveTimeoutScheduler;
}

export interface DispatchContainer {
  /** Driven by the worker: the dispatch job, the wave timeout, and the sweeper's safety net. */
  runWave: (bookingId: string, startWave?: number) => Promise<unknown>;
  expireWave: (bookingId: string, wave: number) => Promise<void>;
  buildDriverRouter: () => Router;
}

export function buildDispatchContainer(deps: DispatchDependencies): DispatchContainer {
  const offers = new MongoOfferRepository();
  const pool = new MongoDriverPool();

  const runWave = new RunDispatchWaveUseCase(
    offers,
    pool,
    deps.bookings,
    deps.settings,
    deps.notifications,
    deps.scheduleWaveTimeout,
  );
  const expireWave = new ExpireWaveUseCase(offers, deps.bookings, runWave);

  const accept = new AcceptOfferUseCase(offers, deps.bookings, deps.notifications);
  const decline = new DeclineOfferUseCase(offers);

  return {
    runWave: (bookingId, startWave) => runWave.execute(bookingId, startWave),
    expireWave: (bookingId, wave) => expireWave.execute(bookingId, wave),
    buildDriverRouter: () =>
      buildDriverRouter({
        current: makeCurrentOfferController(offers, deps.bookings),
        accept: makeAcceptOfferController(accept),
        decline: makeDeclineOfferController(decline),
      }),
  };
}
