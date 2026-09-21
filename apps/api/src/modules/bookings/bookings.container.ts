import type { Router } from 'express';
import { logger } from '../../shared/logging/logger.js';
import type { LedgerWriteContract } from '../ledger/ledger.public.js';
import type { WalletPublicContract } from '../wallet/wallet.public.js';
import type { NotificationsContract } from '../notifications/notifications.public.js';
import type { PaymentsContract } from '../payments/payments.public.js';
import type { QuoteConsumptionContract } from '../quotes/quotes.public.js';
import type { SettingsReadContract } from '../settings/settings.public.js';
import type { IdentityPublicContract } from '../identity/identity.public.js';
import { liveAssignmentCutoff, REASSIGNABLE_STATUSES } from './domain/booking.entity.js';
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
import { SelectPaymentMethodUseCase } from './application/useCases/selectPaymentMethod.usecase.js';
import { ConfirmLatePaymentUseCase } from './application/useCases/confirmLatePayment.usecase.js';
import {
  VerifyExtrasPaymentUseCase,
  VerifyPaymentUseCase,
} from './application/useCases/verifyPayment.usecase.js';
import { PayTripExtrasUseCase } from './application/useCases/payExtras.usecase.js';
import {
  CollectExtrasInCashUseCase,
  DriverSwitchToCashUseCase,
} from './application/useCases/driverSwitchToCash.usecase.js';
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
  /**
   * Called by the payment webhook once a charge settles. Wired at the composition root.
   *
   * TAKES THE PAYMENT ID, not just the booking, because a booking has more than one charge on it
   * and they mean different things: the fare's capture confirms the trip, while an `EXTENSION`
   * capture is a day extension being paid for and must not touch the booking's payment status.
   */
  onPaymentCaptured: (bookingId: string, paymentId: string) => Promise<void>;
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
    deps.settings,
    deps.wallet,
    deps.scheduleDispatch,
  );
  const selectPaymentMethod = new SelectPaymentMethodUseCase(repo, deps.payments, extensions);
  const confirmLate = new ConfirmLatePaymentUseCase(repo, deps.notifications, deps.wallet, deps.payments);
  const verifyPayment = new VerifyPaymentUseCase(repo, deps.payments, confirmLate);
  const payExtras = new PayTripExtrasUseCase(repo, deps.payments, extensions);
  const verifyExtrasPayment = new VerifyExtrasPaymentUseCase(repo, deps.payments);
  const switchToCash = new DriverSwitchToCashUseCase(repo, deps.notifications);
  const collectExtrasInCash = new CollectExtrasInCashUseCase(repo, extensions);
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

      beginSearching: (bookingId, from) =>
        repo.transition({
          bookingId,
          from,
          to: 'SEARCHING',
          actor: { type: 'SYSTEM', id: null },
        }),

      markWaitingForDriver: (bookingId, reason) =>
        repo.transition({
          bookingId,
          from: 'SEARCHING',
          to: 'WAITING_DRIVER',
          actor: { type: 'SYSTEM', id: null },
          reason,
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

      /*
       * FENCED THE SAME WAY THE DRIVER'S OWN `/current` IS, and for a reason that bites harder
       * here: this is what manual assignment checks before handing somebody a trip. Counting a
       * booking they were pre-assigned for next Saturday as "already on a trip" would refuse them
       * every job between now and then — including today's — and refuse a second advance booking
       * on top of the first. A trip that has not come round yet is not one they are driving.
       */
      hasActiveBooking: async (driverId) => {
        const snapshot = await deps.settings.snapshot();
        const active = await repo.findActiveForDriver(
          driverId,
          liveAssignmentCutoff(new Date(), snapshot['dispatch.scheduled_lead_minutes']),
        );
        return active !== null;
      },

      /**
       * The booking is given up on — AND the customer gets their wallet credit back.
       *
       * THE RELEASE IS NEW, AND IT FIXES A REAL LOSS. Credit is spent at booking time
       * (`createBooking` writes `SPENT_ON_RIDE` because the booking confirms synchronously and no
       * later webhook exists to do it), while this used to be nothing but a status transition. A
       * customer who part-paid a fare from their wallet and was never found a driver simply lost
       * that money: no refund path covered it, because there was no payment to refund — the card
       * or cash is chosen after the trip starts, so the wallet was the only thing that had moved.
       *
       * It matters far more now than it did. A booking used to die within minutes of being made;
       * a scheduled one can now die ninety minutes before a pickup arranged days earlier, with
       * the credit held the whole time.
       *
       * `walletDebtPaise` needs no equivalent: debt is collected when a trip is paid for, so a
       * trip that never happened never collected any.
       *
       * THE RELEASE MUST NOT UNDO THE TRANSITION. If appending the entry fails, the booking is
       * still correctly `NO_DRIVER_FOUND` — that is the truth, and refusing to record it would
       * leave a booking searching forever for a wave ladder that has already finished. The
       * mismatch is logged loudly instead, because it is money and somebody has to fix it.
       */
      markNoDriverFound: async (bookingId, reason) => {
        const given = await repo.transition({
          bookingId,
          from: 'SEARCHING',
          to: 'NO_DRIVER_FOUND',
          actor: { type: 'SYSTEM', id: null },
          reason,
        });

        if (given === null || given.walletCreditPaise <= 0) return given;

        try {
          await deps.wallet.append([
            {
              customerId: given.customerId,
              bookingId: given.id,
              entryType: 'RELEASED_FROM_RIDE',
              amountPaise: given.walletCreditPaise,
              note: `Returned from trip ${given.reference} — no driver was found`,
            },
          ]);
        } catch (error) {
          logger.error(
            {
              err: error,
              bookingId,
              reference: given.reference,
              walletCreditPaise: given.walletCreditPaise,
            },
            'NO_DRIVER_FOUND but the wallet credit was NOT released — customer is out of pocket',
          );
        }

        return given;
      },

      findDueForDispatch: (now, limit) => repo.findDueForDispatch(now, limit),

      findWaitingForDriver: (after, limit) => repo.findWaitingForDriver(after, limit),

      findUpcomingAssignedForDriver: (driverId, after) =>
        repo.findUpcomingAssignedForDriver(driverId, after),
    },

    favouritesContract: {
      hasCompletedTripTogether: (customerId, driverId) =>
        repo.hasCompletedTripTogether(customerId, driverId),
    },

    onPaymentCaptured: async (bookingId, paymentId) => {
      /*
       * A DAY EXTENSION BEING PAID FOR, not the trip. It has its own order (see
       * `payExtras.usecase.ts`) because the booking's own was raised, and usually captured, before
       * the extra day existed. Nothing about the booking's payment status changes — the fare was
       * already settled — so this credits the extension and stops.
       *
       * The increment happens HERE and in `VerifyExtrasPaymentUseCase`, and exactly one of them
       * runs for any given capture: both hang off the same compare-and-swap, and this callback is
       * only reached when the webhook itself performed the transition.
       */
      const payment = await deps.payments.findById(paymentId);
      if (payment?.kind === 'EXTENSION') {
        await repo.addPaidExtensionPaise(bookingId, payment.amountPaise);
        return;
      }

      const booking = await repo.findById(bookingId);
      if (booking?.status === 'PENDING_PAYMENT') {
        await confirm.execute(bookingId);
      } else {
        await confirmLate.execute(bookingId);
      }
    },
    onPaymentFailed: async (bookingId, reason) => {
      const booking = await repo.findById(bookingId);
      if (booking?.status === 'PENDING_PAYMENT') {
        const result = await failPayment.execute(bookingId, reason);
        if (result === null) logger.warn({ bookingId }, 'payment failed for an unknown booking');
      } else if (booking) {
        logger.info({ bookingId, reason }, 'late online payment failed');
        await deps.notifications.sendBookingUpdate(
          { role: 'CUSTOMER', id: booking.customerId },
          {
            bookingId: booking.id,
            reference: booking.reference,
            status: booking.status,
            message: 'Your payment did not go through. Please try again to complete online payment.',
          },
        );
      }
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
          deps.settings,
        ),
        cancel: controllers.makeCancelByCustomerController(cancelByCustomer),
        extend: controllers.makeRequestExtensionController(requestExtension),
        selectPaymentMethod: controllers.makeSelectPaymentMethodController(selectPaymentMethod),
        verifyPayment: controllers.makeVerifyPaymentController(verifyPayment),
        payExtras: controllers.makePayTripExtrasController(payExtras),
        verifyExtrasPayment: controllers.makeVerifyExtrasPaymentController(verifyExtrasPayment),
      }),

    buildDriverRouter: () =>
      buildDriverRouter({
        list: controllers.makeListDriverTripsController(repo, charges, deps.identity),
        current: controllers.makeGetCurrentDriverTripController(
          repo,
          charges,
          deps.identity,
          extensions,
          deps.settings,
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
        switchToCash: controllers.makeDriverSwitchToCashController(switchToCash),
        collectExtrasInCash: controllers.makeCollectExtrasInCashController(collectExtrasInCash),
      }),

    buildAdminRouter: () =>
      buildAdminRouter({
        list: controllers.makeListAdminBookingsController(repo, charges, deps.identity),
        get: controllers.makeGetAdminBookingController(repo, charges, deps.identity, extensions),
        events: controllers.makeListEventsController(repo),
        forceArrive: controllers.makeForceArriveController(forceArrive),
        cancel: controllers.makeCancelByAdminController(cancelByAdmin),
      }),
  };
}
