import type { BookingStatus, DeliveryChannel } from '@driverzone/contracts';

/**
 * DOMAIN — what it means to reach a person, described without naming a transport.
 *
 * The port is the point of this module. Today the only adapter is a mock; tomorrow it is FCM
 * plus a Socket.IO server, and the day after it may be FCM plus APNs. None of those changes
 * should reach `dispatch` or `bookings`, which care that a driver was rung and not how.
 */

/**
 * A ringing trip offer — the thing the driver app renders full-screen with a countdown.
 *
 * "VoIP push" is the shorthand for this on iOS, where PushKit and CallKit give an app a
 * privileged ringing path. There is no iOS driver app: docs/prd.md lists it as an explicit
 * non-goal, so the Android equivalent — a high-priority FCM data message waking a full-screen
 * intent, backed by a foreground service while the driver is on duty — is what this becomes.
 * Naming the port for the intent rather than the mechanism is what keeps that swap cheap.
 */
export interface DriverOfferPush {
  offerId: string;
  bookingId: string;
  /** The human reference, `DZ-8F3K2M`. Shown to the driver and quoted to support. */
  reference: string;
  /** When the offer stops being valid. Sent so the client counts down without polling. */
  expiresAt: Date;
  /** What the driver earns if they take it — the single most decision-relevant number. */
  earningPaise: number;
  pickupAddress: string;
  dropAddress: string;
  scheduledAt: Date;
  serviceType: 'INCITY' | 'OUTSTATION';
}

export interface BookingUpdatePush {
  bookingId: string;
  reference: string;
  status: BookingStatus;
  /** Customer-safe copy, displayable verbatim. Clients must never build copy from `status`. */
  message: string;
}

export type Recipient =
  | { role: 'DRIVER'; id: string }
  | { role: 'CUSTOMER'; id: string };

export interface PushSenderPort {
  /**
   * Rings one driver. Returns how it actually got there, which the caller records on the offer
   * so a lapse can later be attributed to the driver or to us.
   *
   * MUST NOT THROW for an undeliverable recipient. A driver whose device token is stale is a
   * `NONE` delivery, not an exception — dispatch has three more drivers to ring and must not
   * abandon a wave because one push failed.
   */
  sendOffer(driverId: string, offer: DriverOfferPush): Promise<DeliveryChannel>;

  /** Closes a ringing offer screen. Best effort by nature — the driver may already have seen it. */
  cancelOffer(driverId: string, offerId: string, reason: string): Promise<void>;

  sendBookingUpdate(to: Recipient, update: BookingUpdatePush): Promise<void>;
}
