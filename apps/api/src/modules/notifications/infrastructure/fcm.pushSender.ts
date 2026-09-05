import type { DeliveryChannel } from '@driverzone/contracts';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type BatchResponse, type Messaging } from 'firebase-admin/messaging';
import { logger } from '../../../shared/logging/logger.js';
import type { DriverDeviceRepositoryPort } from '../../identity/domain/driverDevice.repository.port.js';
import type {
  BookingUpdatePush,
  DriverOfferPush,
  PushSenderPort,
  Recipient,
} from '../domain/pushSender.port.js';

/**
 * INFRASTRUCTURE — the real thing. Firebase Cloud Messaging.
 *
 * **DATA-ONLY MESSAGES, never a `notification` block.** A `notification` payload is drawn by
 * Android itself, on the default channel, with the default sound, once. That is a notification;
 * a trip offer needs a full-screen intent and a looping alarm tone, which only the app can build
 * — and the app only gets the chance if the message arrives as data. Adding a `notification`
 * block "so it shows something" is the single easiest way to break the ring.
 *
 * **Priority high, TTL short.** High priority is what wakes a dozing app; the TTL matches the
 * offer's own expiry because a ring that arrives after the offer lapsed is worse than silence —
 * the driver answers a trip somebody else already has.
 *
 * Nothing here throws for an undeliverable driver. Dispatch rings five at a time and must not
 * abandon a wave because one token went stale (`PushSenderPort`).
 */
export class FcmPushSender implements PushSenderPort {
  constructor(
    private readonly devices: DriverDeviceRepositoryPort,
    private readonly messaging: Messaging,
  ) {}

  async sendOffer(driverId: string, offer: DriverOfferPush): Promise<DeliveryChannel> {
    const ttlMs = Math.max(0, offer.expiresAt.getTime() - Date.now());
    if (ttlMs === 0) {
      logger.warn({ driverId, offerId: offer.offerId }, 'fcm: offer already expired, not sending');
      return 'NONE';
    }

    /*
     * Every value is a STRING. FCM's data payload is `Map<string, string>` and silently rejects
     * anything else, so the numbers and dates are serialised here and parsed back in the app.
     */
    const delivered = await this.send(driverId, {
      type: 'offer.new',
      offerId: offer.offerId,
      bookingId: offer.bookingId,
      reference: offer.reference,
      expiresAt: offer.expiresAt.toISOString(),
      earningPaise: String(offer.earningPaise),
      pickupAddress: offer.pickupAddress,
      dropAddress: offer.dropAddress,
      scheduledAt: offer.scheduledAt.toISOString(),
      serviceType: offer.serviceType,
    }, ttlMs);

    return delivered ? 'FCM' : 'NONE';
  }

  /**
   * Closes a ringing screen on every phone that did not win.
   *
   * Best effort by nature, and worth sending even when it may arrive late: without it a driver
   * who lost the race keeps ringing until the TTL, taps accept, and is told the trip is gone —
   * which is exactly how drivers learn to ignore the ring.
   */
  async cancelOffer(driverId: string, offerId: string, reason: string): Promise<void> {
    await this.send(driverId, { type: 'offer.cancelled', offerId, reason }, 60_000);
  }

  async sendBookingUpdate(to: Recipient, update: BookingUpdatePush): Promise<void> {
    // Only drivers have registered tokens today; a customer update has nowhere to go yet and is
    // dropped rather than pretended.
    if (to.role !== 'DRIVER') return;

    await this.send(
      to.id,
      {
        type: 'booking.updated',
        bookingId: update.bookingId,
        reference: update.reference,
        status: update.status,
        message: update.message,
      },
      15 * 60_000,
    );
  }

  /** Returns whether at least one device took it. */
  private async send(
    driverId: string,
    data: Record<string, string>,
    ttlMs: number,
  ): Promise<boolean> {
    const tokens = await this.devices.tokensFor(driverId);
    if (tokens.length === 0) {
      logger.warn({ driverId, type: data['type'] }, 'fcm: driver has no registered device');
      return false;
    }

    let response: BatchResponse;
    try {
      response = await this.messaging.sendEachForMulticast({
        tokens,
        data,
        android: {
          priority: 'high',
          ttl: ttlMs,
        },
      });
    } catch (error) {
      // A transport failure is ours, not the driver's. Logged and reported as undelivered so the
      // offer records `NONE` and the lapse is not counted against their acceptance rate.
      logger.error({ err: error, driverId, type: data['type'] }, 'fcm: send failed');
      return false;
    }

    await this.pruneDeadTokens(tokens, response);

    logger.info(
      { driverId, type: data['type'], sent: response.successCount, failed: response.failureCount },
      'fcm: push sent',
    );
    return response.successCount > 0;
  }

  /**
   * Forget tokens FCM says are gone.
   *
   * Without this a reinstalled app leaves its old token behind for ever, every wave pays for a
   * send that cannot land, and the `NONE` delivery rate — the metric meant to warn that push is
   * degrading — is permanently polluted by devices that no longer exist.
   */
  private async pruneDeadTokens(
    tokens: string[],
    response: BatchResponse,
  ): Promise<void> {
    const dead = response.responses
      .map((result, index) => ({ result, token: tokens[index] }))
      .filter(
        ({ result }) =>
          result.error?.code === 'messaging/registration-token-not-registered' ||
          result.error?.code === 'messaging/invalid-registration-token',
      )
      .map(({ token }) => token)
      .filter((token): token is string => token !== undefined);

    for (const token of dead) {
      await this.devices.remove(token);
      logger.info({ token: `${token.slice(0, 12)}…` }, 'fcm: removed dead device token');
    }
  }
}

/**
 * Builds the sender, or returns `null` when Firebase is not configured.
 *
 * Null rather than throwing: a developer without credentials should get the mock and a working
 * booking flow, not a server that refuses to boot. The container decides what to do with the
 * absence — see its note on why that choice lives in exactly one place.
 */
export function createFcmMessaging(serviceAccountPath: string): Messaging | null {
  try {
    /*
     * firebase-admin is a process-wide singleton. Re-initialising throws, and this container is
     * built once per process — but the worker and the HTTP server are two processes that each
     * build it, and a test may build it twice. Reusing an existing app is what makes that safe.
     */
    const existing = getApps();
    const app =
      existing.length > 0 && existing[0] !== undefined
        ? existing[0]
        : initializeApp({ credential: cert(serviceAccountPath) });

    return getMessaging(app);
  } catch (error) {
    logger.error(
      { err: error, serviceAccountPath },
      'fcm: could not initialise firebase-admin — falling back to the mock sender',
    );
    return null;
  }
}
