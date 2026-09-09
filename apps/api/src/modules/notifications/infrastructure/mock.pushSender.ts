import type { DeliveryChannel } from '@driverzone/contracts';
import { logger } from '../../../shared/logging/logger.js';
import type {
  BookingUpdatePush,
  DriverOfferPush,
  PushSenderPort,
  Recipient,
} from '../domain/pushSender.port.js';

/**
 * INFRASTRUCTURE — a push sender that delivers nowhere and records everything.
 *
 * This is what makes the whole booking flow walkable before any mobile app exists: a driver is
 * "rung", the log says so, and a test can assert on it. It is not a stub standing in for missing
 * work — it is the adapter the flow runs against until there is a device to receive anything.
 *
 * The real one is `fcm.pushSender.ts`, which does not exist yet. When it does, it implements this
 * same port and the container picks between them; nothing in `dispatch` or `bookings` changes.
 *
 * UNLIKE THE OTHER DEV STUBS IN THIS REPO, this one does not refuse to run in production. It has
 * no credentials to leak and no message to misdeliver, and a deploy that accidentally selects it
 * fails loudly in a better way: every offer lapses undelivered, which the `NONE` delivery channel
 * is already designed to surface. `otpSender.log.ts` refuses because printing an OTP to a log IS
 * the harm; here there is nothing to print that is not already ours.
 */

export interface RecordedPush {
  at: Date;
  kind: 'OFFER' | 'OFFER_CANCELLED' | 'BOOKING_UPDATE' | 'DUTY_ENDED';
  to: Recipient;
  payload: unknown;
}

/** Kept small on purpose: this is a debugging aid, not a store. */
const RING_BUFFER_SIZE = 200;

export class MockPushSender implements PushSenderPort {
  private readonly sent: RecordedPush[] = [];

  async sendOffer(driverId: string, offer: DriverOfferPush): Promise<DeliveryChannel> {
    this.record({
      kind: 'OFFER',
      to: { role: 'DRIVER', id: driverId },
      payload: offer,
    });

    logger.info(
      {
        driverId,
        offerId: offer.offerId,
        reference: offer.reference,
        earningPaise: offer.earningPaise,
        expiresAt: offer.expiresAt.toISOString(),
      },
      'mock push: ringing driver with a trip offer',
    );

    // 'BOTH' is what a healthy real delivery looks like — socket and push together — so the
    // paths that branch on delivery channel are exercised in their normal shape rather than a
    // degenerate one that only the mock ever produces.
    return 'BOTH';
  }

  async cancelOffer(driverId: string, offerId: string, reason: string): Promise<void> {
    this.record({
      kind: 'OFFER_CANCELLED',
      to: { role: 'DRIVER', id: driverId },
      payload: { offerId, reason },
    });
    logger.info({ driverId, offerId, reason }, 'mock push: closing a ringing offer');
  }

  async sendBookingUpdate(to: Recipient, update: BookingUpdatePush): Promise<void> {
    this.record({ kind: 'BOOKING_UPDATE', to, payload: update });
    logger.info(
      { role: to.role, recipientId: to.id, reference: update.reference, status: update.status },
      'mock push: booking update',
    );
  }

  async sendDutyEnded(driverId: string): Promise<void> {
    this.record({ kind: 'DUTY_ENDED', to: { role: 'DRIVER', id: driverId }, payload: {} });
    logger.info({ driverId }, 'mock push: driver taken off duty by the presence sweep');
  }

  /** Everything sent, oldest first. For tests and for the local end-to-end walkthrough. */
  recorded(): readonly RecordedPush[] {
    return this.sent;
  }

  clear(): void {
    this.sent.length = 0;
  }

  private record(push: Omit<RecordedPush, 'at'>): void {
    this.sent.push({ ...push, at: new Date() });
    if (this.sent.length > RING_BUFFER_SIZE) this.sent.shift();
  }
}
