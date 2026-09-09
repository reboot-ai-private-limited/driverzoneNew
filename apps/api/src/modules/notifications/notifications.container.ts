import { env } from '@/config/env.js';
import { logger } from '@/shared/logging/logger.js';
import type {
  CustomerDeviceRepositoryPort,
  DriverDeviceRepositoryPort,
} from '../identity/identity.public.js';
import type { NotificationsPublicContract } from './notifications.public.js';
import { MockPushSender } from './infrastructure/mock.pushSender.js';
import { FcmPushSender, createFcmMessaging } from './infrastructure/fcm.pushSender.js';

export interface NotificationsContainer {
  contract: NotificationsPublicContract;
  /**
   * The mock itself, for tests and for the local end-to-end walkthrough that needs to assert a
   * driver was actually rung. Always constructed, even when FCM is selected, because the tests
   * that hold it must not depend on whether a developer happens to have credentials.
   */
  mock: MockPushSender;
}

/**
 * The one file permitted to name a concrete sender.
 *
 * **Selection is by CONFIGURATION, not by environment.** `FCM_SERVICE_ACCOUNT_PATH` present and
 * loadable means real pushes; absent means the mock. Keying off `NODE_ENV` instead would give
 * every developer a silent mock they cannot opt out of, and would make "does the ring actually
 * work" untestable anywhere but production.
 *
 * A credentials file that is present but broken falls back to the mock with a loud error rather
 * than killing the process — dispatch, bookings and the whole API do not depend on push working,
 * and a typo'd path should not take the server down. The `NONE` delivery channel is what makes
 * the degradation visible afterwards.
 */
/**
 * The device registries, injected rather than constructed.
 *
 * They belong to `identity` — that is where a handset is registered on sign-in and dropped on
 * sign-out. This module only needs somewhere to *send*, so it takes the ports and never learns
 * where a token is stored.
 */
export interface NotificationsDeps {
  driverDevices: DriverDeviceRepositoryPort;
  customerDevices: CustomerDeviceRepositoryPort;
}

export function buildNotificationsContainer(deps: NotificationsDeps): NotificationsContainer {
  const mock = new MockPushSender();

  const path = env.FCM_SERVICE_ACCOUNT_PATH;
  const messaging = path === undefined ? null : createFcmMessaging(path);

  if (messaging === null) {
    logger.warn(
      { configured: path !== undefined },
      path === undefined
        ? 'notifications: FCM_SERVICE_ACCOUNT_PATH not set — using the mock push sender, offers will not reach a real device'
        : 'notifications: firebase-admin failed to initialise — using the mock push sender',
    );

    return {
      contract: {
        sendOffer: (driverId, offer) => mock.sendOffer(driverId, offer),
        cancelOffer: (driverId, offerId, reason) => mock.cancelOffer(driverId, offerId, reason),
        sendBookingUpdate: (to, update) => mock.sendBookingUpdate(to, update),
        sendDutyEnded: (driverId) => mock.sendDutyEnded(driverId),
      },
      mock,
    };
  }

  const sender = new FcmPushSender(deps.driverDevices, messaging, deps.customerDevices);
  logger.info('notifications: FCM push sender active');

  return {
    contract: {
      sendOffer: (driverId, offer) => sender.sendOffer(driverId, offer),
      cancelOffer: (driverId, offerId, reason) => sender.cancelOffer(driverId, offerId, reason),
      sendBookingUpdate: (to, update) => sender.sendBookingUpdate(to, update),
      sendDutyEnded: (driverId) => sender.sendDutyEnded(driverId),
    },
    mock,
  };
}
