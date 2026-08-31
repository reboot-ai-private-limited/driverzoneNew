import { z } from 'zod';

const latLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const createBookingSchema = z
  .object({
    quoteId: z.string().min(1),
    pickupAddress: z.string().min(1).max(500),
    dropAddress: z.string().min(1).max(500),
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
  .object({ actualDistanceM: z.number().int().min(0).optional() })
  .strict();

export const reportPinSchema = z
  .object({ location: latLng, note: z.string().max(500).optional() })
  .strict();

export const forceArriveSchema = z.object({ reason: z.string().min(1).max(500) }).strict();

export const bookingIdParamSchema = z.object({ id: z.string().min(1) });

export type CreateBookingBody = z.input<typeof createBookingSchema>;
export type CancelBookingBody = z.input<typeof cancelBookingSchema>;
export type DriverArrivedBody = z.input<typeof driverArrivedSchema>;
export type StartTripBody = z.input<typeof startTripSchema>;
