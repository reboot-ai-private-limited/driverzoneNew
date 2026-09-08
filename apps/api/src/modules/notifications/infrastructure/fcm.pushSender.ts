import type { DeliveryChannel } from '@driverzone/contracts';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type BatchResponse, type Messaging } from 'firebase-admin/messaging';
import { logger } from '../../../shared/logging/logger.js';
import type { CustomerDeviceRepositoryPort } from '../../identity/domain/customerDevice.repository.port.js';
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
 * **THE TRIP OFFER IS DATA-ONLY, never a `notification` block.** A `notification` payload is drawn
 * by Android itself, on the default channel, with the default sound, once. That is a notification;
 * a trip offer needs a full-screen intent and a looping alarm tone, which only the app can build
 * — and the app only gets the chance if the message arrives as data. Adding a `notification`
 * block to `sendOffer` "so it shows something" is the single easiest way to break the ring.
 *
 * The other two — `sendBookingUpdate` (customer ride updates) and `sendDutyEnded` — DO carry a
 * `notification` block, on purpose: they are not time-critical, they must reach an app that may
 * not be running, and there is nothing the app needs to build that Android cannot draw itself.
 * `data` still rides along so a live app can deep-link rather than double-post.
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
    private readonly customerDevices: CustomerDeviceRepositoryPort,
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
    const data = {
      type: 'booking.updated',
      bookingId: update.bookingId,
      reference: update.reference,
      status: update.status,
      message: update.message,
    };

    // A customer ride update is not time-critical the way a trip offer is, so a data-only
    // high-priority message would spend battery for nothing on the common case (app open, or
    // reachable in the background). It carries a `notification` block so Android draws it even
    // when the app is not running — `data` rides along so a live app deep-links to the trip
    // rather than posting a second banner over what it already showed.
    const tokens =
      to.role === 'DRIVER'
        ? await this.devices.tokensFor(to.id)
        : await this.customerDevices.tokensFor(to.id);
    if (tokens.length === 0) {
      logger.warn({ role: to.role, id: to.id }, 'fcm: booking update — recipient has no device');
      return;
    }

    try {
      const response = await this.messaging.sendEachForMulticast({
        tokens,
        data,
        notification: { title: `Ride ${update.reference}`, body: update.message },
        android: {
          priority: 'normal',
          ttl: 15 * 60_000,
          notification: { channelId: 'booking-updates-v1' },
        },
      });
      await this.pruneRecipientTokens(to, tokens, response);
    } catch (error) {
      logger.error({ err: error, role: to.role, id: to.id }, 'fcm: booking update send failed');
    }
  }

  /** Prune dead tokens for whichever side the recipient is. Mirrors `pruneDeadTokens`. */
  private async pruneRecipientTokens(
    to: Recipient,
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
      if (to.role === 'DRIVER') await this.devices.remove(token);
      else await this.customerDevices.remove(token);
    }
  }

  /**
   * THE ONE MESSAGE THAT CARRIES A `notification` BLOCK, and the exception proves the rule at the
   * top of this file.
   *
   * Every other push here is data-only because the APP has to draw it — a full-screen ringing
   * intent is something Android cannot build on its own. This one is the opposite case: it is sent
   * because the driver's process is GONE, so there is nothing left to draw anything. A data-only
   * message would be handed to a background handler that is not running and would simply be lost,
   * which is how the driver ends up never being told. A `notification` block is rendered by
   * Android itself with no app code involved, which is the entire reason to use one here.
   *
   * `data` rides along anyway, for the case where the app IS alive — an OEM froze the ping loop
   * without killing the process — so a running app can refresh its duty state rather than keep
   * showing "You're online".
   *
   * **It will not reach a FORCE-STOPPED app.** Android delivers nothing at all to a package in the
   * stopped state until the user launches it by hand, and no payload shape changes that (S-1). It
   * does reach the far more common cases: a reboot, an OEM battery kill, and a low-memory
   * reclamation.
   *
   * Normal priority and a long TTL, deliberately. This is not time-critical the way an offer is —
   * the shift has already ended — and a high-priority wake would spend the driver's battery to
   * tell them their battery settings killed the app.
   */
  async sendDutyEnded(driverId: string): Promise<void> {
    const tokens = await this.devices.tokensFor(driverId);
    if (tokens.length === 0) return;

    try {
      const response = await this.messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: 'You have been taken offline',
          body: 'DriverZone stopped reporting your location, so you stopped receiving trips. Open the app to go back on duty.',
        },
        data: { type: 'duty.ended' },
        android: {
          priority: 'normal',
          ttl: 24 * 60 * 60_000,
          notification: {
            /*
             * `duty-alert-v1`, NOT the `duty-status` channel the foreground service uses. That one
             * is LOW importance by design — it is on screen for a whole shift and must never make
             * a sound — and posting this on it would inherit that silence, for the one message a
             * driver has to notice. The app declares both in `notifications/channel.ts`; this id
             * must match the one there or Android drops the notification without a word.
             */
            channelId: 'duty-alert-v1',
            // Tapping it opens the app, which is the only action that fixes anything here.
            clickAction: 'android.intent.action.MAIN',
          },
        },
      });

      await this.pruneDeadTokens(tokens, response);
      logger.info(
        { driverId, sent: response.successCount, failed: response.failureCount },
        'fcm: duty-ended notice sent',
      );
    } catch (error) {
      // Best effort by contract. The sweep has already taken them off duty, which is the part that
      // matters; failing to say so must not abort the rest of the batch.
      logger.error({ err: error, driverId }, 'fcm: duty-ended notice failed');
    }
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
