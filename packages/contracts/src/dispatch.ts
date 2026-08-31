/**
 * Dispatch — the realtime surface between the server and the driver app.
 *
 * FROZEN NOW, IMPLEMENTED LATER. The Socket.IO server lands with the driver app, because there
 * is no client to hold a connection until then. The event NAMES are here already because
 * docs/LLD/roadmap.md makes contracts the critical path for the mobile team, and a name that
 * changes after an app is in a store binary you cannot recall is expensive in a way a name
 * chosen early is not.
 *
 * WHY A SOCKET AND NOT JUST PUSH. A 45-second ringing offer cannot be carried by FCM alone:
 * Xiaomi, Oppo, Vivo and Realme battery managers — the bulk of the Indian driver market — delay
 * or drop high-priority messages to backgrounded apps, sometimes by minutes
 * (docs/LLD/dispatch-and-assignment.md §Notification delivery). The design is belt and braces:
 * the socket is the fast path whenever the app is foreground or a foreground service is running,
 * and the push wakes the app when it is not. Both are sent every time.
 */

export const DRIVER_SOCKET_NAMESPACE = '/driver';

/** Server → driver. */
export const DRIVER_SOCKET_EVENTS = {
  /** A new offer is ringing. Carries its own expiry so the client counts down locally. */
  offerNew: 'offer.new',
  /**
   * Stop ringing. Sent when another driver won the race, when the customer cancelled, or when
   * the offer lapsed — a driver staring at a dead offer screen is the thing this prevents.
   */
  offerCancelled: 'offer.cancelled',
  bookingUpdated: 'booking.updated',
} as const;

/** Driver → server. */
export const DRIVER_SOCKET_EMITS = {
  locationPing: 'location.ping',
} as const;

/**
 * How an offer actually reached a driver, recorded on the offer itself.
 *
 * `NONE` is the operationally important one: an offer that lapsed but was never delivered is an
 * INFRASTRUCTURE failure, not a driver failure, and must not count against their acceptance rate.
 * Without this column that distinction is unrecoverable after the fact.
 */
export const DELIVERY_CHANNELS = ['SOCKET', 'FCM', 'BOTH', 'NONE'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
