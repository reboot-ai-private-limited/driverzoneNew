import { z } from 'zod';

/**
 * A 24-character hex ObjectId. Spelled here rather than `z.string().min(1)` because an id that
 * cannot be one is a caller error worth a 400, not a lookup that quietly finds nothing.
 */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Not a valid driver id.');

export const addFavouriteSchema = z.object({ driver_id: objectId }).strict();

export const driverIdParamSchema = z.object({ driverId: objectId });
