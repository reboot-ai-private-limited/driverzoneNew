import type { LatLngDto, Money } from './http.js';

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

/**
 * The ringing offer as the DRIVER APP receives it — `GET /driver/offers/current`, and the same
 * shape an FCM data message carries when one arrives while the app is closed.
 *
 * Distinct from `DriverOfferPush` on the server side: that is the domain's way of describing an
 * intent to ring someone; this is the wire shape, snake_case and pre-formatted, that a client
 * renders without arithmetic.
 */
export interface DriverOfferDto {
  offer_id: string;
  booking_id: string;
  /** The human reference, `DZ-8F3K2M`. Shown to the driver and quoted to support. */
  reference: string;
  /** ISO-8601. The client counts down from this rather than polling for expiry. */
  expires_at: string;
  /** What the driver earns if they take it — the single most decision-relevant number. */
  earning: Money;
  pickup: LatLngDto & { address: string };
  /**
   * Where the trip ends. Shown on the ring screen so the driver can judge the trip before
   * accepting — an outstation drop 200 km away and a drop two streets over are the same earning
   * line but very different decisions. `AcceptOfferResponse` still carries it too, for the trip
   * screen after the claim.
   */
  drop: LatLngDto & { address: string };
  scheduled_at: string;
  service_type: 'INCITY' | 'OUTSTATION';
}

/**
 * `GET /driver/offers` — every offer currently ringing for this driver, SOONEST-EXPIRING FIRST.
 *
 * PLURAL, DELIBERATELY (2026-09-04). A driver can legitimately hold more than one live offer at
 * once — dispatch's matching does not exclude a driver who already has an open offer or is
 * mid-trip, and that is a deliberate choice, not a bug to close here. What changed is the app: it
 * used to assume a single "current" offer (`findOne`, no sort — arbitrary the moment two existed)
 * and rendered whichever one that returned, while its Accept/Decline buttons acted on the offer
 * id from the route instead. The two could disagree. This is the fix: the driver app now asks for
 * everything that is actually ringing and is responsible for presenting more than one without
 * confusion, rather than the server pretending there is only ever one.
 *
 * An empty array is the ordinary "nothing is ringing" answer, not an error.
 */
export interface ListDriverOffersResponse {
  offers: DriverOfferDto[];
}

/**
 * `POST /driver/offers/:id/accept`.
 *
 * LOSING THE RACE IS A 200, not an error. Four of five drivers lose every wave and every one of
 * them did exactly what was asked; reporting that as a failure would bury genuine dispatch faults
 * under normal behaviour. Clients branch on `claimed`, never on the HTTP status.
 */
export type AcceptOfferResponse =
  | {
      claimed: true;
      booking_id: string;
      reference: string;
      pickup: LatLngDto & { address: string };
      drop: LatLngDto & { address: string };
      scheduled_at: string;
      earning: Money;
    }
  | {
      claimed: false;
      reason: string;
      /** Customer-safe copy, displayable verbatim. Never build this from `reason`. */
      message: string;
    };

export interface DeclineOfferResponse {
  declined: true;
}

// ─── The scheduled board ────────────────────────────────────────────────────────────────────

/**
 * One trip on the drivers' scheduled board — `GET /driver/scheduled-bookings`.
 *
 * A booking whose early search found nobody and which is now parked in `WAITING_DRIVER`, waiting
 * either for a driver to take it here or for the final ring at T−90
 * (docs/LLD/dispatch-and-assignment.md §Ring early, park, ring again).
 *
 * **IT IS NOT AN OFFER, and the shape says so.** An offer rings, counts against an acceptance rate
 * and expires in forty-five seconds. This is a list a driver browses in their own time: nothing is
 * ringing, ignoring it costs them nothing, and it stays until somebody takes it. So there is no
 * `offer_id` and no `expires_at` — the only clock that matters is the pickup itself.
 */
export interface ScheduledBoardBookingDto {
  booking_id: string;
  reference: string;
  /** What the driver earns — their share, after commission, exactly as on the ring screen. */
  earning: Money;
  pickup: LatLngDto & { address: string };
  drop: LatLngDto & { address: string };
  /** When the customer wants to be picked up. The whole reason this list is browsable. */
  scheduled_at: string;
  service_type: 'INCITY' | 'OUTSTATION';
  /** Roughly how long the trip is expected to run, so a driver can judge it against their day. */
  estimated_minutes: number;
}

export interface ListScheduledBoardResponse {
  bookings: ScheduledBoardBookingDto[];
}

/**
 * `POST /driver/scheduled-bookings/:id/accept`.
 *
 * SHAPED LIKE `AcceptOfferResponse` ON PURPOSE, including `claimed: false` being a 200. Two
 * drivers can open this board and tap the same trip, and the loser has done nothing wrong — the
 * same reasoning that governs the accept race on a ringing offer applies here, over a much longer
 * window, because a parked booking can sit on the board for days.
 *
 * `reason` is for logs and `message` is for the driver, and the client must never build one from
 * the other: "somebody else took it" and "this clashes with a trip you already hold" are the same
 * refusal to a state machine and completely different news to a person.
 */
export type AcceptScheduledBookingResponse =
  | {
      claimed: true;
      booking_id: string;
      reference: string;
      pickup: LatLngDto & { address: string };
      drop: LatLngDto & { address: string };
      scheduled_at: string;
      earning: Money;
    }
  | {
      claimed: false;
      reason: string;
      message: string;
    };
