import type { NotificationsPublicContract } from './notifications.public.js';
import { MockPushSender } from './infrastructure/mock.pushSender.js';

export interface NotificationsContainer {
  contract: NotificationsPublicContract;
  /**
   * The mock itself, for tests and for the local end-to-end walkthrough that needs to assert a
   * driver was actually rung. Typed as the concrete class on purpose — it is the one thing in
   * this container that is explicitly not part of the port, and it disappears the day the real
   * adapter is selected.
   */
  mock: MockPushSender;
}

/**
 * The FCM adapter is not written. When it is, the choice between them belongs here and nowhere
 * else — this is the only file in the module permitted to name a concrete class.
 */
export function buildNotificationsContainer(): NotificationsContainer {
  const sender = new MockPushSender();

  return {
    contract: {
      sendOffer: (driverId, offer) => sender.sendOffer(driverId, offer),
      cancelOffer: (driverId, offerId, reason) => sender.cancelOffer(driverId, offerId, reason),
      sendBookingUpdate: (to, update) => sender.sendBookingUpdate(to, update),
    },
    mock: sender,
  };
}
