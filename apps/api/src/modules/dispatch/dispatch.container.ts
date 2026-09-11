import type { Router } from 'express';
import type { BookingDispatchContract } from '../bookings/bookings.public.js';
import type { AssignableDriversContract } from '../identity/identity.public.js';
import type { FavouriteDriversContract } from '../favourites/favourites.public.js';
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
import { TransferBookingUseCase } from './application/useCases/transferBooking.usecase.js';
import {
  makeAcceptOfferController,
  makeAssignDriverController,
  makeAssignableDriversController,
  makeDeclineOfferController,
  makeListOffersController,
} from './interface/dispatch.controller.js';
import { buildAdminRouter, buildDriverRouter } from './interface/dispatch.routes.js';

export interface DispatchDependencies {
  bookings: BookingDispatchContract;
  settings: SettingsReadContract;
  notifications: NotificationsContract;
  /**
   * Whose drivers to ring first, when the booking asked for it. IDS ONLY — this module never
   * renders a favourite and has no business holding their names or numbers.
   */
  favourites: FavouriteDriversContract;
  /**
   * Who an admin may hand a trip to, for the manual-assignment picker. Read-only and search-only:
   * this module decides who GETS a booking, never who is a driver.
   */
  identity: AssignableDriversContract;
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
  /** `/admin/bookings/assignable-drivers` and `/admin/bookings/:id/assign`. */
  buildAdminRouter: () => Router;
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
    deps.favourites,
  );
  const expireWave = new ExpireWaveUseCase(offers, deps.bookings, runWave);

  const accept = new AcceptOfferUseCase(offers, deps.bookings, deps.notifications);
  /*
   * `runWave` is passed as a thunk, and it has to be: a decline that empties its wave widens the
   * search immediately, so this use case needs the wave runner that was built two lines above it.
   * The arrow defers the reference rather than creating a construction cycle.
   */
  const decline = new DeclineOfferUseCase(offers, deps.bookings, (bookingId, wave) =>
    runWave.execute(bookingId, wave),
  );

  const transfer = new TransferBookingUseCase(
    deps.bookings,
    deps.identity,
    offers,
    deps.notifications,
  );

  return {
    runWave: (bookingId, startWave) => runWave.execute(bookingId, startWave),
    expireWave: (bookingId, wave) => expireWave.execute(bookingId, wave),
    buildDriverRouter: () =>
      buildDriverRouter({
        list: makeListOffersController(offers, deps.bookings),
        accept: makeAcceptOfferController(accept),
        decline: makeDeclineOfferController(decline),
      }),

    buildAdminRouter: () =>
      buildAdminRouter({
        assignableDrivers: makeAssignableDriversController(deps.identity, deps.bookings),
        assign: makeAssignDriverController(transfer),
      }),
  };
}
