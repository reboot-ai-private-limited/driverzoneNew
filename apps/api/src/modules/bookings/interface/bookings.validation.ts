import { z } from 'zod';
import {
  BOOKING_STATUSES,
  CAR_CATEGORIES,
  PAYMENT_MODES,
  VEHICLE_TYPE_PREFERENCES,
} from '@driverzone/contracts';

const latLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

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
     * OPTIONAL WITH A DEFAULT, unlike the two above, and for the opposite reason. A missing car
     * category is a question nobody answered; a missing favourites flag is an answer — the app
     * that did not send it is one that predates the feature, and it wants the dispatch behaviour
     * it has always had. `.strict()` still rejects anything else.
     */
    preferFavouriteDrivers: z.boolean().optional().default(false),
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

export type CreateBookingBody = z.input<typeof createBookingSchema>;
export type CancelBookingBody = z.input<typeof cancelBookingSchema>;
export type DriverArrivedBody = z.input<typeof driverArrivedSchema>;
export type StartTripBody = z.input<typeof startTripSchema>;
