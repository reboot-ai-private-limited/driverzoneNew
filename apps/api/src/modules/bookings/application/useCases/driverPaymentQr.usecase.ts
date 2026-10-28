import type { PaymentQrState } from '@driverzone/contracts';
import { AppError } from '../../../../shared/errors/AppError.js';
import { logger } from '../../../../shared/logging/logger.js';
import type { NotificationsContract } from '../../../notifications/notifications.public.js';
import { isCaptured, type Payment, type PaymentsContract } from '../../../payments/payments.public.js';
import type { SettingsReadContract } from '../../../settings/settings.public.js';
import type { Booking } from '../../domain/booking.entity.js';
import type { BookingRepositoryPort } from '../../domain/bookingRepository.port.js';
import type { ExtensionRepositoryPort } from '../../domain/extensionRepository.port.js';
import { totalExtension } from '../../domain/bookingExtension.entity.js';
import { netPayablePaise } from '../../domain/payable.js';
import { loadForDriver } from '../bookingAccess.js';
import { waitingChargeFor } from '../tripWaiting.js';

/** How long a QR stays payable. Long enough to scan at the kerb, short enough not to linger. */
export const PAYMENT_QR_MINUTES = 15;

/** Razorpay will not take less. A trip whose wallet credit covers all but pennies has nothing to scan. */
const MIN_QR_PAISE = 100;

/**
 * What a QR was made up of — remembered on the payment row as `metadata`, because the amount alone
 * cannot say which parts of the trip it already paid for, and `completeTrip` needs to know.
 */
export interface QrBreakdown {
  farePaise: number;
  /** The extra day(s) still unpaid when the QR was made. */
  extensionPaise: number;
  waitingPaise: number;
  creditPaise: number;
  debtPaise: number;
}

export interface PaymentQrView {
  state: PaymentQrState;
  payment: Payment | null;
}

export interface PaymentQrResult {
  booking: Booking;
  qr: PaymentQrView;
}

/** The breakdown a QR payment row remembers, read back — missing keys are zero. */
export function breakdownOf(payment: Payment): QrBreakdown {
  const m = payment.metadata;
  return {
    farePaise: m['farePaise'] ?? 0,
    extensionPaise: m['extensionPaise'] ?? 0,
    waitingPaise: m['waitingPaise'] ?? 0,
    creditPaise: m['creditPaise'] ?? 0,
    debtPaise: m['debtPaise'] ?? 0,
  };
}

/**
 * THE DRIVER COLLECTS THE WHOLE TRIP BY QR.
 *
 * Creating a QR makes it the trip's online payment: the booking becomes UPI / awaiting payment,
 * exactly as if the customer had chosen to pay online in their own app. That is not a detail — the
 * rest of the system already knows what to do with a UPI trip (the end-trip slide stays locked
 * until the server has CAPTURED the money; a capture marks it paid and tells the driver), and
 * `ConfirmLatePaymentUseCase` REFUNDS any online money that lands on a trip that is not UPI.
 *
 * WHAT THE QR CHARGES is everything this trip will cost: the fare, an extra day the customer has
 * bought and not yet paid for, the waiting charge (fixed once the trip has started), less wallet
 * credit already spent, plus any old dues. Nothing is left to ask for at the end.
 *
 * THE DRIVER CAN ALWAYS TAKE CASH INSTEAD — nothing here removes that.
 */
export class DriverPaymentQrUseCase {
  constructor(
    private readonly repo: BookingRepositoryPort,
    private readonly payments: PaymentsContract,
    private readonly extensions: ExtensionRepositoryPort,
    private readonly settings: SettingsReadContract,
    private readonly notifications: NotificationsContract,
    /**
     * What happens when a capture is learned of by THIS call rather than the webhook — the same
     * function the webhook's callback runs, so the money is credited exactly once either way.
     */
    private readonly onCaptured: (bookingId: string, paymentId: string) => Promise<void>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** `POST` — a live QR for the trip: the one already showing if it is still right, else a new one. */
  async create(input: { bookingId: string; driverId: string }): Promise<PaymentQrResult> {
    const booking = await loadForDriver(this.repo, input.bookingId, input.driverId);

    if (booking.status !== 'STARTED') {
      throw AppError.badRequest('You can collect payment once the trip has started.');
    }
    if (booking.paymentMode === 'PREPAID') {
      throw AppError.conflict('This trip is already paid for. There is nothing to collect.');
    }
    if (booking.paymentStatus === 'PAID') {
      throw AppError.conflict('This trip has already been paid for.');
    }

    const breakdown = await this.breakdownFor(booking);
    const amountPaise = netPayablePaise({
      farePaise: breakdown.farePaise,
      extrasPaise: breakdown.extensionPaise,
      waitingPaise: breakdown.waitingPaise,
      walletCreditPaise: breakdown.creditPaise,
      walletDebtPaise: breakdown.debtPaise,
    });
    if (amountPaise < MIN_QR_PAISE) {
      throw AppError.badRequest('There is nothing left to collect online for this trip.');
    }

    const qrPayments = (await this.payments.listForBooking(booking.id)).filter(isBookingQr);

    // Already paid — the webhook beat the booking's own status. Nothing to make.
    const paid = qrPayments.find((p) => isCaptured(p.status));
    if (paid !== undefined) return { booking, qr: { state: 'PAID', payment: paid } };

    const now = this.now();
    const live = qrPayments.find((p) => p.status === 'PENDING' && isLive(p, now));
    if (live !== undefined && live.amountPaise === amountPaise) {
      return { booking, qr: { state: 'PENDING', payment: live } };
    }

    // A QR for a different amount (an extra day was accepted since), or one that ran out of time:
    // closed, so it cannot be paid after the driver has been shown a different one.
    for (const stale of qrPayments.filter((p) => p.status === 'PENDING')) {
      await this.payments.closeQr(stale.id, live === undefined ? 'The QR code expired' : 'Replaced by a new QR');
    }

    const payment = await this.payments.chargeByQr({
      bookingId: booking.id,
      customerId: booking.customerId,
      kind: 'BOOKING',
      amountPaise,
      reference: booking.reference,
      // The attempt number keeps a NEW QR (after an expiry) from colliding with the dead one's key,
      // while a double-tapped request for the same attempt still collapses to one payment.
      idempotencyKey: `qr-${booking.id}-${String(amountPaise)}-${String(qrPayments.length)}`,
      expiresAt: new Date(now.getTime() + PAYMENT_QR_MINUTES * 60_000),
      metadata: { ...breakdown },
    });

    await this.repo.setPaymentMode(booking.id, 'UPI', 'AWAITING_PAYMENT');
    await this.repo.attachPayment(booking.id, payment.id);

    await this.tellCustomer(booking, amountPaise);

    logger.info(
      { bookingId: booking.id, paymentId: payment.id, amountPaise },
      'driver started a payment QR for the trip',
    );

    return { booking: (await this.repo.findById(booking.id)) ?? booking, qr: { state: 'PENDING', payment } };
  }

  /**
   * `GET` — where the QR stands. Asks the gateway directly if it has not heard, so a lost or
   * unreachable webhook (local development) does not leave the driver staring at "waiting".
   */
  async status(input: { bookingId: string; driverId: string }): Promise<PaymentQrResult> {
    const booking = await loadForDriver(this.repo, input.bookingId, input.driverId);

    const qrPayments = (await this.payments.listForBooking(booking.id)).filter(isBookingQr);
    const latest = qrPayments.at(-1);
    if (latest === undefined) {
      return { booking, qr: { state: booking.paymentStatus === 'PAID' ? 'PAID' : 'NONE', payment: null } };
    }

    const refreshed = await this.payments.refreshQr(latest.id);
    const payment = refreshed?.payment ?? latest;

    // THIS call learned of the capture, not the webhook — so the credit happens here, once.
    if (refreshed?.justCaptured === true) await this.onCaptured(booking.id, payment.id);

    return {
      booking: (await this.repo.findById(booking.id)) ?? booking,
      qr: { state: stateOf(payment, this.now()), payment },
    };
  }

  private async breakdownFor(booking: Booking): Promise<QrBreakdown> {
    const snapshot = await this.settings.snapshot();
    const extras = totalExtension(await this.extensions.listForBooking(booking.id));

    return {
      farePaise: booking.fareSnapshot.fare.totalPaise,
      // Only the part not already paid online — an extra day bought and paid mid-trip is done.
      extensionPaise: Math.max(0, extras.amountPaise - booking.paidExtensionPaise),
      waitingPaise: waitingChargeFor(booking, snapshot).amountPaise,
      creditPaise: booking.walletCreditPaise,
      debtPaise: booking.walletDebtPaise,
    };
  }

  private async tellCustomer(booking: Booking, amountPaise: number): Promise<void> {
    try {
      await this.notifications.sendBookingUpdate(
        { role: 'CUSTOMER', id: booking.customerId },
        {
          bookingId: booking.id,
          reference: booking.reference,
          status: booking.status,
          message: `Your driver is collecting ₹${String(Math.round(amountPaise / 100))} by QR. Scan it with any UPI app to pay.`,
        },
      );
    } catch (error) {
      // The QR is on the driver's screen either way; a missed nudge costs nothing.
      logger.warn({ err: error, bookingId: booking.id }, 'could not tell the customer a payment QR is up');
    }
  }
}

function isBookingQr(payment: Payment): boolean {
  return payment.kind === 'BOOKING' && payment.channel === 'QR';
}

function isLive(payment: Payment, now: Date): boolean {
  return payment.qr !== null && payment.qr.expiresAt.getTime() > now.getTime();
}

function stateOf(payment: Payment, now: Date): PaymentQrState {
  if (isCaptured(payment.status)) return 'PAID';
  if (payment.status === 'FAILED') return 'EXPIRED';
  // CREATED is the instant before the gateway has answered; to the driver it is still "getting it".
  return isLive(payment, now) || payment.status === 'CREATED' ? 'PENDING' : 'EXPIRED';
}
