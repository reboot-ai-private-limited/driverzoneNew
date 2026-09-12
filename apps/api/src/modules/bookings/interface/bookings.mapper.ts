import type {
  BookingDto,
  BookingEventDto,
  BookingPaymentStatus,
  BookingStatus,
} from '@driverzone/contracts';
import type { CustomerContact, DriverCard } from '../../identity/identity.public.js';
import { toMoney } from '../../../shared/money/format.js';
import type { Booking } from '../domain/booking.entity.js';
import type { BookingEvent } from '../domain/bookingRepository.port.js';
import type { FareAdjustment } from '../domain/chargeRepository.port.js';
import type { BookingExtension } from '../domain/bookingExtension.entity.js';
import { totalExtension } from '../domain/bookingExtension.entity.js';
import {
  extensionRefusal,
  extensionRefusalMessage,
} from '../application/useCases/extendBooking.usecase.js';

export interface BookingView {
  booking: Booking;
  adjustments: readonly FareAdjustment[];
  /**
   * Every day-extension request on this booking, whatever its status.
   *
   * OPTIONAL, and absent means "not looked up" rather than "there are none" — the same convention
   * `driverCard` and `customerName` follow. A read that does not pass it renders `extension: null`,
   * which the apps treat as nothing to show. The customer's and driver's live-trip reads pass it;
   * a history list does not, because a finished trip cannot be extended and the list would pay a
   * query per row to say so.
   */
  extensions?: readonly BookingExtension[] | undefined;
  /**
   * The trip code, supplied ONLY when the customer is reading their own booking.
   *
   * Passed in rather than read off the entity, so that including it is an explicit decision at
   * each call site. The driver's mapper simply never passes it — which is the point, since the
   * whole value of the code is that the driver has to be told it by a person standing there.
   */
  startOtp?: string | null | undefined;
  driverName?: string | null | undefined;
  /**
   * The customer's name, supplied only where a caller has a reason to see it — the driver's own
   * trip history and trip detail.
   *
   * Passed in rather than read off the entity for the same reason `startOtp` is: resolving it is
   * a lookup in another module, and making it an argument keeps "who gets to see this" a decision
   * at the call site instead of a default the mapper quietly applies everywhere.
   *
   * `undefined` (not passed) yields `customer: null`, so the DTO distinguishes a name that was
   * never looked up from an account that has none — see the field's own note in contracts.
   */
  customerName?: string | null | undefined;
  /**
   * The customer as the DRIVER on their trip sees them — name plus the number to call at the
   * kerb. The mirror of `driverCard`, supplied only on the driver's single-trip reads.
   *
   * Passed in for the same reason the others are: resolving it is a lookup in another module.
   * When present it supersedes `customerName` — the phone is gated on the trip being live, see
   * `PHONE_VISIBLE_STATUSES`. The driver's ride-history LIST still passes `customerName` alone,
   * because a finished trip has no kerb to call.
   */
  customerCard?: CustomerContact | null | undefined;
  /**
   * The driver as a customer sees them, supplied only on a CUSTOMER-facing read.
   *
   * Passed in for the same reason `startOtp` and `customerName` are: resolving it is a lookup in
   * another module, and making it an argument keeps "who gets to see this" a decision at the call
   * site. The driver's own reads never pass it — a driver does not need their own card, and it
   * carries a phone number.
   */
  driverCard?: DriverCard | null | undefined;
  /**
   * Lifts the live-trip gate on both phone numbers. ADMIN READS ONLY.
   *
   * `PHONE_VISIBLE_STATUSES` exists to stop the two PARTIES holding each other's numbers after
   * the trip that justified it — a customer from three months ago has no business keeping their
   * driver's login number. An admin is not a party to the trip and the reasoning does not
   * transfer: the panel already renders `mobile_number` on the customer and driver directories
   * (`CustomerDetailScreen`), so a booking table that hides it is not protecting anything, it is
   * making support open a second screen to find a number they already have.
   *
   * An explicit flag rather than the mapper inferring it from the caller, because that is the
   * rule this whole interface follows: who gets to see what is decided at the call site, where
   * someone reviewing that endpoint can see the decision being made.
   */
  revealPhones?: boolean | undefined;
  /**
   * Puts the driver's own cut of a pending day extension on the response. DRIVER READS ONLY.
   *
   * The same rule as `revealPhones` above, aimed at the other party: a driver deciding whether to
   * commit their next 24 hours is owed the number, and a customer looking at the same booking has
   * no business being shown what their driver's share of a package is. An explicit flag rather
   * than the mapper inferring it from the caller, because that is the rule this whole interface
   * follows.
   */
  revealDriverEarnings?: boolean | undefined;
  paymentStatus?: BookingPaymentStatus | undefined;
}

/**
 * The statuses in which the two parties may have each other's phone number.
 *
 * EACH NEEDS TO REACH THE OTHER AT THE KERB, and that is the whole justification — so it lasts
 * exactly as long as the kerb does. On a completed or cancelled trip the number is withheld by
 * the server rather than merely hidden by the app, because a field that was never sent cannot be
 * read out of a cached response or a screenshot of one. The gate is symmetric: the customer's
 * view of `driver.phone` and the driver's view of `customer.phone` open and close together.
 *
 * `SEARCHING` and `CONFIRMED` are absent because no driver is assigned in them; there is nobody to
 * ring. Listed explicitly rather than derived from "not terminal" so that a status added to the
 * machine later is a deliberate decision about a phone number, not something a negation absorbs.
 */
const PHONE_VISIBLE_STATUSES: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED',
  'STARTED',
]);

/**
 * Whether this read may carry a phone number: the trip is live, or an admin lifted the gate.
 *
 * One function so the customer's view of the driver and the driver's view of the customer cannot
 * drift apart — the gate is symmetric by construction rather than by two call sites agreeing.
 */
function canSeePhone(view: BookingView): boolean {
  return view.revealPhones === true || PHONE_VISIBLE_STATUSES.has(view.booking.status);
}

export function toBookingDto(view: BookingView): BookingDto {
  const { booking } = view;
  const { fare } = booking.fareSnapshot;

  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    service_type: booking.serviceType,
    payment_mode: booking.paymentMode,
    payment_status:
      view.paymentStatus ??
      booking.paymentStatus ??
      (booking.paymentMode === null
        ? 'NOT_SELECTED'
        : booking.paymentMode === 'CASH'
          ? 'CASH'
          : 'AWAITING_PAYMENT'),

    pickup: { ...booking.pickup, address: booking.pickupAddress },
    drop: { ...booking.drop, address: booking.dropAddress },

    distance_km: booking.distanceKm,

    scheduled_at: booking.scheduledAt.toISOString(),
    is_scheduled: booking.isScheduled,
    dispatch_at: booking.dispatchAt.toISOString(),

    car_category: booking.carCategory,
    vehicle_type: booking.vehicleType,
    prefer_favourite_drivers: booking.preferFavouriteDrivers,

    wallet_credit: toMoney(booking.walletCreditPaise),
    wallet_debt: toMoney(booking.walletDebtPaise),

    included_minutes: booking.fareSnapshot.included.minutes,

    start_otp: view.startOtp ?? null,

    driver: toDriverDto(view),

    customer: toCustomerDto(view),

    fare: {
      lines: fare.lines.map((line) => ({
        code: line.code,
        label: line.label,
        amount: toMoney(line.amountPaise),
      })),
      subtotal: toMoney(fare.subtotalPaise),
      tax: toMoney(fare.taxPaise),
      total: toMoney(fare.totalPaise),
    },

    /*
     * Separate from `fare`, never merged into it. The fare is what the customer agreed to and is
     * immutable (B-1); an adjustment is what happened afterwards. Showing them as one list would
     * make a receipt that cannot explain which was which.
     */
    adjustments: view.adjustments.map((adjustment) => ({
      type: adjustment.type,
      label: adjustment.label,
      amount: toMoney(adjustment.amountPaise),
    })),

    payable: toPayableBlock(view),

    extension: toExtensionBlock(view),

    timestamps: {
      assigned_at: booking.assignedAt?.toISOString() ?? null,
      en_route_at: booking.enRouteAt?.toISOString() ?? null,
      arrived_at: booking.arrivedAt?.toISOString() ?? null,
      started_at: booking.startedAt?.toISOString() ?? null,
      completed_at: booking.completedAt?.toISOString() ?? null,
      cancelled_at: booking.cancelledAt?.toISOString() ?? null,
    },

    cancellation_reason: booking.cancellationReason,
  };
}

/**
 * The driver on a booking, at whatever detail the call site resolved.
 *
 * THREE CASES, and they are genuinely different. No driver assigned yet is `null`. A driver
 * assigned but no card looked up — every driver-facing read, and the admin's — is the id and the
 * name, which is exactly what this field carried before customer cards existed. A card resolved
 * is the full thing, with the phone number gated on the trip still being live.
 */
function toDriverDto(view: BookingView): BookingDto['driver'] {
  const { booking } = view;
  if (booking.driverId === null) return null;

  const card = view.driverCard;
  if (card === null || card === undefined) {
    return {
      id: booking.driverId,
      name: view.driverName ?? null,
      photo_url: null,
      rating: null,
      rating_count: 0,
      phone: null,
    };
  }

  return {
    id: booking.driverId,
    name: card.fullName,
    photo_url: card.photoUrl,
    rating: card.rating,
    rating_count: card.ratingCount,
    // The gate. See `PHONE_VISIBLE_STATUSES`.
    phone: canSeePhone(view) ? card.phone : null,
  };
}

/**
 * The customer on a booking, at whatever detail the call site resolved — the mirror of
 * `toDriverDto`.
 *
 * THREE CASES. A call site that resolved nothing (`customerName` and `customerCard` both absent)
 * produces `null` — "not looked up", distinct from an account with no name. A `customerCard`
 * resolved is name plus a phone number gated on the trip still being live. A `customerName`
 * alone — the driver's ride-history list, and every admin read — is name only, `phone: null`,
 * exactly what the field carried before.
 */
function toCustomerDto(view: BookingView): BookingDto['customer'] {
  const { booking } = view;

  const card = view.customerCard;
  if (card !== null && card !== undefined) {
    return {
      id: booking.customerId,
      name: card.fullName,
      // The gate. Symmetric with `toDriverDto` — see `PHONE_VISIBLE_STATUSES`.
      phone: canSeePhone(view) ? card.phone : null,
    };
  }

  if ('customerName' in view) {
    return { id: booking.customerId, name: view.customerName ?? null, phone: null };
  }

  return null;
}

/**
 * The history, rendered as it is stored.
 *
 * Support staff should never have to ask an engineer what happened to a booking — this is the
 * list that makes that true, so nothing is summarised or filtered on the way out.
 */
/**
 * What accepted day extensions add to this booking, from whichever source this read has.
 *
 * TWO SOURCES, NEVER SUMMED. A live-trip read passes `extensions` and the answer is the sum of the
 * accepted rows. A read that did not — every history list — still has the truth for a FINISHED
 * trip, because `completeTrip` writes the same total onto one `DAY_EXTENSION` adjustment row.
 * Adding both together would double every extension on the one read that carries both.
 *
 * The rows win when present: they are current mid-trip, whereas the adjustment row does not exist
 * until completion.
 */
function extensionPaise(view: BookingView): number {
  if (view.extensions !== undefined) return totalExtension(view.extensions).amountPaise;

  const row = view.adjustments.find((adjustment) => adjustment.type === 'DAY_EXTENSION');
  return row?.amountPaise ?? 0;
}

/**
 * The one figure both apps show as the price. See `BookingDto.payable` for why it exists at all.
 *
 * COMPUTED HERE RATHER THAN IN EACH APP, which is the entire point: the customer's total, the
 * driver's "collect this much in cash" line and `expectedCashPaise` in `completeTrip.usecase.ts`
 * are three renderings of one number, and they were three different numbers because each screen
 * did its own arithmetic on `fare.total`.
 *
 * THE WALLET IS PART OF IT. Credit came off what the customer owes and a carried-over cancellation
 * fee was added to it, so a driver told to collect the gross fare on a cash trip collects money the
 * customer already spent — which is exactly the mismatch `expectedCashPaise` documents.
 */
function toPayableBlock(view: BookingView): BookingDto['payable'] {
  const { booking } = view;
  const farePaise = booking.fareSnapshot.fare.totalPaise;
  const extrasPaise = extensionPaise(view);
  const waitingPaise = booking.waitingChargePaise ?? 0;

  const totalPaise = Math.max(
    0,
    farePaise + extrasPaise + waitingPaise - booking.walletCreditPaise + booking.walletDebtPaise,
  );

  /*
   * ONLY THE EXTENSION CAN BE OUTSTANDING — on a UPI trip, and only WHILE IT IS STILL RUNNING.
   *
   * The fare itself has its own gate — `completeTrip` refuses to end a UPI trip whose booking
   * charge has not captured — and the waiting charge is not known until the trip is already over,
   * so neither is something the customer can be asked to pay at this moment. An extension is: the
   * driver has agreed to it, it has a price, and the trip is still under way.
   *
   * THE `STARTED` CLAUSE IS NOT DECORATION. This field is what puts a "Pay for your extra day"
   * button on the customer's trip screen, and `PayTripExtrasUseCase` refuses anything that is not
   * STARTED — so without it a finished trip carrying an uncollected extension (one completed
   * before that gate existed, or whose fare was switched to cash afterwards) would show a button
   * that returns a 400 every single time it is pressed. Such an extension is a receivable for ops
   * to chase, exactly like an uncollected waiting charge, not something to ask the customer for on
   * a trip that is over.
   *
   * `paidExtensionPaise` is whatever has already been collected for it — folded into the booking
   * order by `SelectPaymentMethodUseCase` when the extension predated payment, or captured by the
   * extras order afterwards. On a cash trip it is nothing, because the driver takes the lot at the
   * door.
   */
  const outstandingPaise =
    booking.paymentMode === 'UPI' && booking.status === 'STARTED'
      ? Math.max(0, extrasPaise - booking.paidExtensionPaise)
      : 0;

  return {
    fare_total: toMoney(farePaise),
    extension_total: toMoney(extrasPaise),
    waiting_total: toMoney(waitingPaise),
    wallet_credit: toMoney(booking.walletCreditPaise),
    wallet_debt: toMoney(booking.walletDebtPaise),
    total: toMoney(totalPaise),
    outstanding: toMoney(outstandingPaise),
  };
}

/**
 * The day-extension block, or `null` when this read was not asked to resolve one.
 *
 * `can_extend` IS DECIDED HERE, ONCE, by the same `extensionRefusal` the request endpoint itself
 * runs. That shared function is the point: two copies of five conditions is how an app comes to
 * show an Extend button on a trip the server refuses, and the customer learns the difference by
 * tapping it.
 */
function toExtensionBlock(view: BookingView): BookingDto['extension'] {
  if (view.extensions === undefined) return null;

  const { booking } = view;
  const pending = view.extensions.find((extension) => extension.status === 'PENDING') ?? null;
  const agreed = totalExtension(view.extensions);

  const refusal = extensionRefusal(booking, pending !== null);
  const perDay = booking.fareSnapshot.fare.perDay ?? null;

  return {
    can_extend: refusal === null,
    reason: refusal === null ? null : extensionRefusalMessage(refusal),
    price: perDay === null ? null : toMoney(perDay.farePaise),
    pending:
      pending === null
        ? null
        : {
            id: pending.id,
            amount: toMoney(pending.amountPaise),
            expires_at: pending.expiresAt.toISOString(),
            driver_amount:
              view.revealDriverEarnings === true
                ? toMoney(pending.driverAmountPaise)
                : null,
          },
    extra_days: agreed.days,
    extra_amount: toMoney(agreed.amountPaise),
  };
}

export function toBookingEventDto(event: BookingEvent): BookingEventDto {
  return {
    from_status: event.fromStatus,
    to_status: event.toStatus,
    actor_type: event.actorType,
    reason: event.reason,
    metadata: event.metadata,
    at: event.createdAt.toISOString(),
  };
}
