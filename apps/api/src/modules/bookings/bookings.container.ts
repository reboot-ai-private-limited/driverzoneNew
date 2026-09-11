import type { Router } from 'express';
import { logger } from '../../shared/logging/logger.js';
import type { LedgerWriteContract } from '../ledger/ledger.public.js';
import type { WalletPublicContract } from '../wallet/wallet.public.js';
import type { NotificationsContract } from '../notifications/notifications.public.js';
import type { PaymentsContract } from '../payments/payments.public.js';
import type { QuoteConsumptionContract } from '../quotes/quotes.public.js';
import type { SettingsReadContract } from '../settings/settings.public.js';
import type { IdentityPublicContract } from '../identity/identity.public.js';
import { REASSIGNABLE_STATUSES } from './domain/booking.entity.js';
import type {
  BookingFavouritesContract,
  BookingsPublicContract,
  ClaimResult,
} from './bookings.public.js';
import { MongoBookingRepository } from './infrastructure/bookingRepository.impl.js';
import { MongoChargeRepository } from './infrastructure/chargeRepository.impl.js';
import { MongoExtensionRepository } from './infrastructure/extensionRepository.impl.js';
import {
  RequestBookingExtensionUseCase,
  RespondToExtensionUseCase,
} from './application/useCases/extendBooking.usecase.js';
import { CreateBookingUseCase } from './application/useCases/createBooking.usecase.js';
import {
  ConfirmBookingPaymentUseCase,
  FailBookingPaymentUseCase,
  type DispatchScheduler,
} from './application/useCases/confirmBookingPayment.usecase.js';
import {
  CancelBookingByAdminUseCase,
  CancelBookingByCustomerUseCase,
  CancelBookingByDriverUseCase,
} from './application/useCases/cancelBooking.usecase.js';
import { DriverArrivedUseCase } from './application/useCases/driverArrived.usecase.js';
import { StartTripUseCase } from './application/useCases/startTrip.usecase.js';
import { CompleteTripUseCase } from './application/useCases/completeTrip.usecase.js';
import {
  DriverEnRouteUseCase,
  ForceArriveUseCase,
  ReportPickupPinUseCase,
} from './application/useCases/driverProgress.usecase.js';
import * as controllers from './interface/bookings.controller.js';
import {
  buildAdminRouter,
  buildCustomerRouter,
  buildDriverRouter,
} from './interface/bookings.routes.js';

export interface BookingsDependencies {
  quotes: QuoteConsumptionContract;
  payments: PaymentsContract;
  settings: SettingsReadContract;
  ledger: LedgerWriteContract;
  /** The CUSTOMER wallet: credit off a fare, debt onto it, and where a fee becomes a debt. */
  wallet: WalletPublicContract;
  notifications: NotificationsContract;
  /**
   * Naming a person, describing a driver to the customer they are driving, and recording
   * driver ride completion stats.
   */
  identity: IdentityPublicContract;
  /**
   * Enqueues the dispatch job for a confirmed booking.
   *
   * Injected because `dispatch` is a TIER ABOVE this module and cannot be imported. The
   * composition root closes that loop — which is also what keeps "only dispatch writes
   * `driverId`" true, since `bookings` never learns how dispatch works.
   */
  scheduleDispatch: DispatchScheduler;
}

export interface BookingsContainer {
  contract: BookingsPublicContract;
  /**
   * The one boolean `favourites` is allowed to ask, exposed separately from `contract` for the
   * same Interface Segregation reason `reviews` gets a read-only view: handing a module that only
   * needs "have these two ridden together" the dispatch contract would hand it `claimForDriver`.
   */
  favouritesContract: BookingFavouritesContract;
  /** Called by the payment webhook once a charge settles. Wired at the composition root. */
  onPaymentCaptured: (bookingId: string) => Promise<void>;
  onPaymentFailed: (bookingId: string, reason: string) => Promise<void>;
  /** The sweeper's housekeeping: bookings whose payment never arrived. Returns how many expired. */
  sweepAbandonedPayments: (before: Date, limit: number) => Promise<number>;
  /**
   * Day-extension requests the driver never answered. Returns how many lapsed.
   *
   * THE SWEEP IS THE CLOCK, the same way it is for a blind review whose window closed — no queue
   * job, because nothing needs a per-request timer and one indexed query a minute survives a Redis
   * flush that a scheduled job would not.
   */
  expireStaleExtensions: (now: Date, limit: number) => Promise<number>;
  buildCustomerRouter: () => Router;
  buildDriverRouter: () => Router;
  buildAdminRouter: () => Router;
}

export function buildBookingsContainer(deps: BookingsDependencies): BookingsContainer {
  const repo = new MongoBookingRepository();
  const charges = new MongoChargeRepository();
  const extensions = new MongoExtensionRepository();

  const create = new CreateBookingUseCase(
    repo,
    deps.quotes,
    deps.payments,
    deps.settings,
    charges,
    deps.wallet,
    deps.scheduleDispatch,
  );
  const confirm = new ConfirmBookingPaymentUseCase(
    repo,
    deps.notifications,
    deps.scheduleDispatch,
    deps.wallet,
  );
  const failPayment = new FailBookingPaymentUseCase(repo, deps.notifications);

  const cancelByCustomer = new CancelBookingByCustomerUseCase(
    repo,
    charges,
    deps.settings,
    deps.payments,
    deps.wallet,
    deps.notifications,
  );
  const cancelByDriver = new CancelBookingByDriverUseCase(
    repo,
    charges,
    deps.settings,
    deps.ledger,
    deps.notifications,
  );

  /*
   * No charges, no settings, no ledger and no wallet — the three constructor arguments ARE the
   * feature. An admin cancellation charges nobody, so there is nothing to read a fee ladder from
   * and nothing to record against either party.
   */
  const cancelByAdmin = new CancelBookingByAdminUseCase(repo, deps.payments, deps.notifications);

  const enRoute = new DriverEnRouteUseCase(repo, deps.notifications);
  const arrived = new DriverArrivedUseCase(repo, deps.settings, deps.ledger, deps.notifications);
  const start = new StartTripUseCase(repo, deps.settings, deps.notifications);
  const complete = new CompleteTripUseCase(
    repo,
    charges,
    deps.settings,
    deps.ledger,
    deps.payments,
    deps.notifications,
    extensions,
    deps.identity,
  );
  const reportPin = new ReportPickupPinUseCase(repo, charges);

  const requestExtension = new RequestBookingExtensionUseCase(
    repo,
    extensions,
    deps.settings,
    deps.notifications,
  );
  const respondToExtension = new RespondToExtensionUseCase(repo, extensions, deps.notifications);
  const forceArrive = new ForceArriveUseCase(repo, deps.notifications);

  return {
    contract: {
      findById: (bookingId) => repo.findById(bookingId),

      beginSearching: (bookingId) =>
        repo.transition({
          bookingId,
          from: 'CONFIRMED',
          to: 'SEARCHING',
          actor: { type: 'SYSTEM', id: null },
        }),

      claimForDriver: async (bookingId, driverId, actor): Promise<ClaimResult> => {
        const claimed = await repo.claimForDriver(bookingId, driverId, actor);
        if (claimed !== null) return { claimed: true, booking: claimed };

        /*
         * Losing needs a diagnosis, because the driver's app says something different for each
         * case — and because only some of them may count against an acceptance rate. Losing to
         * another driver never does.
         */
        const current = await repo.findById(bookingId);
        if (current === null) return { claimed: false, reason: 'NOT_FOUND' };
        if (current.driverId !== null) return { claimed: false, reason: 'ALREADY_ASSIGNED' };
        return { claimed: false, reason: 'NOT_SEARCHING' };
      },

      releaseDriver: async (bookingId, reason, adminId) => {
        const current = await repo.findById(bookingId);
        if (current === null) return null;

        /*
         * The `from` is read rather than assumed, because three statuses are reassignable and
         * `transition` swaps on exactly one. Anything else — STARTED, already cancelled, still
         * searching — is refused here rather than by the transition table, so the caller gets a
         * clear "not reassignable" instead of a lost compare-and-swap it has to diagnose.
         */
        if (!REASSIGNABLE_STATUSES.includes(current.status)) return null;

        return repo.transition({
          bookingId,
          from: current.status,
          to: 'SEARCHING',
          actor: { type: 'ADMIN', id: adminId },
          reason,
          metadata: { releasedDriverId: current.driverId, atStatus: current.status },
          // Both, together. Leaving `assignedAt` set would date the NEXT driver's assignment to
          // when the previous one took it.
          patch: { driverId: null, assignedAt: null },
        });
      },

      hasActiveBooking: async (driverId) => (await repo.findActiveForDriver(driverId)) !== null,

      markNoDriverFound: (bookingId, reason) =>
        repo.transition({
          bookingId,
          from: 'SEARCHING',
          to: 'NO_DRIVER_FOUND',
          actor: { type: 'SYSTEM', id: null },
          reason,
        }),

      findDueForDispatch: (now, limit) => repo.findDueForDispatch(now, limit),
    },

    favouritesContract: {
      hasCompletedTripTogether: (customerId, driverId) =>
        repo.hasCompletedTripTogether(customerId, driverId),
    },

    onPaymentCaptured: async (bookingId) => {
      await confirm.execute(bookingId);
    },
    onPaymentFailed: async (bookingId, reason) => {
      const result = await failPayment.execute(bookingId, reason);
      if (result === null) logger.warn({ bookingId }, 'payment failed for an unknown booking');
    },

    expireStaleExtensions: (now, limit) => extensions.expireStale(now, limit),

    sweepAbandonedPayments: async (before, limit) => {
      const abandoned = await repo.findAbandonedPayments(before, limit);
      let expired = 0;

      for (const booking of abandoned) {
        const result = await repo.transition({
          bookingId: booking.id,
          from: 'PENDING_PAYMENT',
          to: 'EXPIRED',
          actor: { type: 'SYSTEM', id: null },
          metadata: { via: 'sweeper', reason: 'payment never completed' },
        });
        if (result !== null) expired += 1;
      }

      return expired;
    },

    buildCustomerRouter: () =>
      buildCustomerRouter({
        create: controllers.makeCreateBookingController(create),
        list: controllers.makeListCustomerBookingsController(repo, charges, deps.identity),
        dues: controllers.makeGetDuesController(deps.wallet),
        get: controllers.makeGetCustomerBookingController(repo, charges, deps.identity, extensions),
        current: controllers.makeGetCurrentCustomerBookingController(
          repo,
          charges,
          deps.identity,
          extensions,
        ),
        cancel: controllers.makeCancelByCustomerController(cancelByCustomer),
        extend: controllers.makeRequestExtensionController(requestExtension),
      }),

    buildDriverRouter: () =>
      buildDriverRouter({
        list: controllers.makeListDriverTripsController(repo, charges, deps.identity),
        current: controllers.makeGetCurrentDriverTripController(
          repo,
          charges,
          deps.identity,
          extensions,
        ),
        get: controllers.makeGetDriverBookingController(repo, charges, deps.identity, extensions),
        enRoute: controllers.makeEnRouteController(enRoute),
        arrived: controllers.makeArrivedController(arrived),
        reportPin: controllers.makeReportPinController(reportPin),
        start: controllers.makeStartTripController(start),
        complete: controllers.makeCompleteTripController(complete, charges),
        cancel: controllers.makeCancelByDriverController(cancelByDriver),
        acceptExtension: controllers.makeRespondToExtensionController(respondToExtension, true),
        declineExtension: controllers.makeRespondToExtensionController(respondToExtension, false),
      }),

    buildAdminRouter: () =>
      buildAdminRouter({
        list: controllers.makeListAdminBookingsController(repo, charges, deps.identity),
        get: controllers.makeGetAdminBookingController(repo, charges, deps.identity),
        events: controllers.makeListEventsController(repo),
        forceArrive: controllers.makeForceArriveController(forceArrive),
        cancel: controllers.makeCancelByAdminController(cancelByAdmin),
      }),
  };
}
