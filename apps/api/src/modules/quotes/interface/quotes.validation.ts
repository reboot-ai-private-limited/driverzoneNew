import { z } from 'zod';
import { DIRECTIONS } from '@driverzone/contracts';

/**
 * INTERFACE — the boundary. Nothing past this file re-validates.
 *
 * Coordinates are bounds-checked here only for obvious nonsense; the India plausibility tripwire
 * that catches a swapped lat/lng lives in `@driverzone/geo` and runs during zone resolution,
 * where it belongs — it is a domain rule, not a wire-format one.
 */

const latLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const createQuoteSchema = z
  .object({
    pickup: latLng,
    drop: latLng,
    /**
     * Accepted, but never trusted as "now". A device with a wrong clock would otherwise book into
     * the past and skip straight through the scheduled-dispatch window; the use case substitutes
     * server time when this is absent, and the booking module range-checks it when it is not.
     */
    scheduledAt: z.coerce.date().optional(),
    direction: z.enum(DIRECTIONS).optional(),
    /**
     * The return instant, for an outstation round trip. A PRICE INPUT — the band fare is a day
     * rate and the server multiplies by the days between this and `scheduledAt`.
     *
     * Only the ordering is checked here. How many days that spans, and whether the span is within
     * `outstation.max_trip_days`, are questions for the use case: the cap is a setting, and this
     * file has no business reading settings.
     */
    returnAt: z.coerce.date().optional(),
    /** Omitted means the insurance line stays on — see CreateQuoteRequest. */
    insurance: z.boolean().optional(),
  })
  .strict()
  /*
   * A return before the departure is not a short trip, it is a typo — and left alone it would
   * reach `istCalendarDaysInclusive`, which floors at 1, and quietly price as a same-day trip.
   * Refusing here is what stops a nonsense date becoming a plausible fare.
   */
  .refine(
    (input) =>
      input.returnAt === undefined ||
      input.scheduledAt === undefined ||
      input.returnAt.getTime() > input.scheduledAt.getTime(),
    { path: ['returnAt'], message: 'The return has to be after the pickup.' },
  );

export type CreateQuoteBody = z.input<typeof createQuoteSchema>;
export type CreateQuoteInputParsed = z.infer<typeof createQuoteSchema>;
