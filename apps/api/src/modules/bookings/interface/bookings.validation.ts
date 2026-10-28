import { z } from 'zod';
import {
  ADMIN_PAYMENT_MODES,
  BOOKING_STATUSES,
  CAR_CATEGORIES,
  EXTRAS_COLLECTIONS,
  PAYMENT_MODES,
  DRIVER_TRIP_GROUPS,
  PAYMENT_OVERRIDE_REASONS,
  RIDE_HISTORY_GROUPS,
  RIDE_HISTORY_SORTS,
  VEHICLE_TYPE_PREFERENCES,
} from '@driverzone/contracts';

const latLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/*
 * BOOKING FOR SOMEONE ELSE — the passenger. E.164 for the number, the identity module's rule
 * (`identity.validation.ts`): the client normalises, the server refuses anything else.
 */
const rider = z
  .object({
    name: z.string().trim().min(1).max(80),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, 'Enter the mobile number in international format, e.g. +919876543210'),
  })
  .strict();

export const createBookingSchema = z
  .object({
    quoteId: z.string().min(1),
    pickupAddress: z.string().min(1).max(500),
    dropAddress: z.string().min(1).max(500),
    /** Optional: payment mode is now chosen after the ride has STARTED. */
    paymentMode: z.enum(PAYMENT_MODES).optional(),
    /*
     * REQUIRED, and deliberately without a default. These decide which drivers are rung, so a
     * defaulted SEDAN would quietly send a customer with an SUV a driver who never agreed to
     * drive one — the kind of wrong answer that looks like the system working.
     */
    carCategory: z.enum(CAR_CATEGORIES),
    vehicleType: z.enum(VEHICLE_TYPE_PREFERENCES),
    /*
     * WHICH CAR. Both optional — older app builds send neither, and the customer's default car is
     * used. The plate rule matches the profile's own (`identity.validation.ts`): lenient, because
     * rejecting a real plate in an odd format is far worse than accepting one.
     */
    vehicleId: z.string().min(1).max(64).optional(),
    plateNumber: z.string().trim().min(4).max(16).optional(),
    /** Optional: absent means the customer is travelling themselves, as every older app assumes. */
    rider: rider.optional(),
    /*
     * OPTIONAL WITH A DEFAULT, unlike the two above, and for the opposite reason. A missing car
     * category is a question nobody answered; a missing favourites flag is an answer — the app
     * that did not send it is one that predates the feature, and it wants the dispatch behaviour
     * it has always had. `.strict()` still rejects anything else.
     */
    preferFavouriteDrivers: z.boolean().optional().default(false),
  })
  .strict();

/**
 * `POST /admin/bookings` — an admin booking ON A CUSTOMER'S BEHALF. Snake_case like the rest of
 * the admin surface.
 *
 * `payment_mode` IS REQUIRED, with no default: "prepaid" means the driver collects nothing, so a
 * booking that silently defaulted the wrong way would either have a driver demand money already
 * paid, or not collect money that is owed. The admin says which.
 */
export const adminCreateBookingSchema = z
  .object({
    customer_id: z.string().regex(/^[a-f0-9]{24}$/i, 'customer_id must be a customer id'),
    quote_id: z.string().min(1),
    pickup_address: z.string().trim().min(1).max(500),
    drop_address: z.string().trim().min(1).max(500),
    car_category: z.enum(CAR_CATEGORIES),
    vehicle_type: z.enum(VEHICLE_TYPE_PREFERENCES),
    payment_mode: z.enum(ADMIN_PAYMENT_MODES),
    payment_reference: z.string().trim().max(200).optional(),
    rider: rider.optional(),
  })
  .strict();

/** The driver's payment override. The reason is required; a note is required for `OTHER` (use case). */
export const paymentOverrideSchema = z
  .object({
    reason: z.enum(PAYMENT_OVERRIDE_REASONS),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const selectPaymentMethodSchema = z
  .object({
    payment_mode: z.enum(PAYMENT_MODES),
  })
  .strict();

/**
 * What a checkout SDK hands back on success. The ORDER id is deliberately NOT accepted here — it
 * is read from the booking's own payment row instead, because a caller who can choose both halves
 * of the signed `order_id|payment_id` message can sign it themselves.
 */
export const verifyPaymentSchema = z
  .object({
    razorpay_payment_id: z.string().min(1).max(200),
    razorpay_signature: z.string().min(1).max(500),
  })
  .strict();

/**
 * The same, for the separate order that collects a day extension.
 *
 * `payment_id` IS OURS, not the gateway's — the row `extras/pay` returned. It is needed because,
 * unlike the fare, an extras order is not the one hanging off `booking.payment_id`, and a trip
 * extended twice has more than one. The use case still checks it belongs to this booking, so
 * accepting it here grants nothing: the ORDER id is what must never come from the caller, and
 * still does not.
 */
export const verifyExtrasPaymentSchema = verifyPaymentSchema.extend({
  payment_id: z.string().min(1).max(200),
});

/**
 * A reason is mandatory on every cancellation, on both sides.
 *
 * An unexplained cancellation is one nobody can act on later, and these are precisely the events
 * somebody will be asked about — a driver's cancellation rate, a customer disputing a fee.
 */
export const cancelBookingSchema = z.object({ reason: z.string().min(1).max(500) }).strict();

/**
 * `takenAt` is when the fix was taken on the DEVICE, not when the request arrived. The server
 * refuses one older than a minute, because a four-minute-old fix taken on a motorway is several
 * kilometres from where the driver is now — which is exactly how someone "arrives" from the road.
 */
export const driverArrivedSchema = z
  .object({
    location: latLng.extend({ takenAt: z.coerce.date() }),
  })
  .strict();

export const startTripSchema = z
  .object({
    otp: z.string().regex(/^\d{4}$/, 'The trip code is four digits'),
    location: latLng.optional(),
  })
  .strict();

export const completeTripSchema = z
  .object({
    actualDistanceM: z.number().int().min(0).optional(),
    /** What the driver actually took, on a cash trip. Absent falls back to the expected total. */
    cashCollectedPaise: z.number().int().min(0).optional(),
    /** How the extras were settled. Optional: an older driver app sends nothing (see the use case). */
    extrasCollection: z.enum(EXTRAS_COLLECTIONS).optional(),
  })
  .strict();

export const reportPinSchema = z
  .object({ location: latLng, note: z.string().max(500).optional() })
  .strict();

export const forceArriveSchema = z.object({ reason: z.string().min(1).max(500) }).strict();

export const bookingIdParamSchema = z.object({ id: z.string().min(1) });

/**
 * A calendar day as the admin panel sends it. Parsed here rather than trusted, because
 * `new Date('nonsense')` is an Invalid Date that Mongo will happily accept and match nothing —
 * a filter that silently returns zero rows is indistinguishable from a quiet day.
 */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  /*
   * ROUND-TRIPPED, not merely parsed. `Date.parse('2025-02-30')` does NOT fail — JavaScript rolls
   * the surplus day over and hands back the 2nd of March. A plain "is this parseable" check
   * therefore accepts a date that does not exist and then filters by a different day than the one
   * asked for, which is far worse than a 400: the admin gets rows and no reason to doubt them.
   * Formatting the parsed date back and comparing is what catches the rollover.
   */
  .refine((value) => new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value), {
    message: 'Not a real date',
  });

/**
 * `GET /admin/bookings`. Query params arrive as strings, so every number is transformed.
 *
 * `limit` caps at 100, matching `adminCustomerListQuerySchema` — the panel asks for 10 and the cap
 * is there so a hand-written URL cannot ask for the whole collection in one response.
 */
export const adminBookingListQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .refine((n) => !Number.isNaN(n) && n >= 1, 'Page must be >= 1'),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 10))
    .refine((n) => !Number.isNaN(n) && n >= 1 && n <= 100, 'Limit must be between 1 and 100'),
  search: z.string().trim().max(120).optional(),
  /**
   * Comma-separated statuses. An UNKNOWN one is rejected rather than dropped: silently ignoring it
   * would answer a question the caller did not ask and look like the filter simply found nothing.
   */
  status: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.split(',')))
    .refine(
      (list) => list === undefined || list.every((s) => (BOOKING_STATUSES as readonly string[]).includes(s)),
      'Unknown booking status',
    ),
  from: isoDay.optional(),
  to: isoDay.optional(),
});

/**
 * `GET /customer/bookings`. With NO `limit` this is the old unpaged read — the newest
 * `HISTORY_LIMIT` rows, no cursor — so app builds already on phones keep working unchanged.
 *
 * The cursor is opaque to the app: base64url JSON of `{ k, i }` (sort key, booking id). A cursor
 * that does not decode is a 400 rather than "start again from the top", which would silently
 * repeat a page the customer has already scrolled past.
 */
const historyCursor = z
  .string()
  .max(200)
  .transform((value, ctx) => {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { k?: unknown }).k === 'number' &&
        Number.isFinite((parsed as { k: number }).k) &&
        typeof (parsed as { i?: unknown }).i === 'string'
      ) {
        return { key: (parsed as { k: number }).k, id: (parsed as { i: string }).i };
      }
    } catch {
      // Falls through to the issue below.
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid cursor' });
    return z.NEVER;
  });

const isoInstant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const customerHistoryQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .refine((n) => n === undefined || (!Number.isNaN(n) && n >= 1 && n <= 50), 'Limit must be between 1 and 50'),
  cursor: historyCursor.optional(),
  group: z.enum(RIDE_HISTORY_GROUPS).optional(),
  from: isoInstant.optional(),
  before: isoInstant.optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(RIDE_HISTORY_SORTS).default('NEWEST'),
});

/**
 * `GET /driver/bookings`. Same contract as the customer's: with NO `limit` it is the old capped
 * list, so driver builds already on phones keep working unchanged.
 */
export const driverHistoryQuerySchema = z.object({
  limit: customerHistoryQuerySchema.shape.limit,
  cursor: historyCursor.optional(),
  group: z.enum(DRIVER_TRIP_GROUPS).optional(),
  from: isoInstant.optional(),
  before: isoInstant.optional(),
  q: z.string().trim().max(120).optional(),
});

/** The inverse of `historyCursor`, for the response. */
export function encodeHistoryCursor(cursor: { key: number; id: string }): string {
  return Buffer.from(JSON.stringify({ k: cursor.key, i: cursor.id }), 'utf8').toString('base64url');
}

export type CreateBookingBody = z.input<typeof createBookingSchema>;
export type CancelBookingBody = z.input<typeof cancelBookingSchema>;
export type DriverArrivedBody = z.input<typeof driverArrivedSchema>;
export type StartTripBody = z.input<typeof startTripSchema>;
