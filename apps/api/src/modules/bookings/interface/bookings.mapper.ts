import type { BookingDto, BookingEventDto } from '@driverzone/contracts';
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

    pickup: { ...booking.pickup, address: booking.pickupAddress },
    drop: { ...booking.drop, address: booking.dropAddress },

    scheduled_at: booking.scheduledAt.toISOString(),
    is_scheduled: booking.isScheduled,

    start_otp: view.startOtp ?? null,

    driver:
      booking.driverId === null
        ? null
        : { id: booking.driverId, name: view.driverName ?? null },

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
