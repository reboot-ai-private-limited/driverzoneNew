import type { DeliveryChannel } from '@driverzone/contracts';
import type {
  BookingUpdatePush,
  DriverOfferPush,
  Recipient,
} from './domain/pushSender.port.js';

/**
 * PUBLIC CONTRACT — the only surface other modules may import from `notifications`.
 *
 * Structurally the same as `PushSenderPort`, and deliberately re-declared rather than
 * re-exported: the port is what an ADAPTER implements, this is what a CONSUMER calls. They agree
 * today; the day a consumer needs "notify both parties" as one call, that method belongs here and
 * not on every adapter.
 *
 * Nothing here throws on an undeliverable recipient. Dispatch rings five drivers at a time and
 * must not abandon a wave because one device token went stale — an unreachable driver is a
 * `NONE` delivery, recorded on the offer and excluded from their acceptance rate.
 */
export interface NotificationsContract {
  sendOffer(driverId: string, offer: DriverOfferPush): Promise<DeliveryChannel>;
  cancelOffer(driverId: string, offerId: string, reason: string): Promise<void>;
  sendBookingUpdate(to: Recipient, update: BookingUpdatePush): Promise<void>;

  /**
   * Tell a driver the presence sweep took them off duty because their handset went silent. The
   * worker is the only caller; see `PushSenderPort.sendDutyEnded` for why this one is aimed at an
   * app that is probably not running.
   */
  sendDutyEnded(driverId: string): Promise<void>;
}

export type NotificationsPublicContract = NotificationsContract;

export type {
  BookingUpdatePush,
  DriverOfferPush,
  Recipient,
} from './domain/pushSender.port.js';
