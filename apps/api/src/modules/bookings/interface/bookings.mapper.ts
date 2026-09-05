import type { BookingDto, BookingEventDto, BookingStatus } from '@driverzone/contracts';
import type { CustomerContact, DriverCard } from '../../identity/identity.public.js';
import { toMoney } from '../../../shared/money/format.js';
import type { Booking } from '../domain/booking.entity.js';
import type { BookingEvent } from '../domain/bookingRepository.port.js';
import type { FareAdjustment } from '../domain/chargeRepository.port.js';

export interface BookingView {
  booking: Booking;
  adjustments: readonly FareAdjustment[];
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

export function toBookingDto(view: BookingView): BookingDto {
  const { booking } = view;
  const { fare } = booking.fareSnapshot;

  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    service_type: booking.serviceType,
    payment_mode: booking.paymentMode,

    pickup: { ...booking.pickup, address: booking.pickupAddress },
    drop: { ...booking.drop, address: booking.dropAddress },

    scheduled_at: booking.scheduledAt.toISOString(),
    is_scheduled: booking.isScheduled,

    car_category: booking.carCategory,
    vehicle_type: booking.vehicleType,

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
    phone: PHONE_VISIBLE_STATUSES.has(booking.status) ? card.phone : null,
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
      phone: PHONE_VISIBLE_STATUSES.has(booking.status) ? card.phone : null,
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
