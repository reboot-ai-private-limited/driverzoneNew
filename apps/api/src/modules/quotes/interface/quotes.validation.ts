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
    /** Omitted means the insurance line stays on — see CreateQuoteRequest. */
    insurance: z.boolean().optional(),
  })
  .strict();

export type CreateQuoteBody = z.input<typeof createQuoteSchema>;
export type CreateQuoteInputParsed = z.infer<typeof createQuoteSchema>;
