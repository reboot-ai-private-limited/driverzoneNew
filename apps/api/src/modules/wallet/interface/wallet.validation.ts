import { z } from 'zod';

/**
 * INTERFACE — Zod at the boundary, per docs/engineering/coding-standards.md.
 *
 * The SIGN is not checked here, only the shape. `validateWalletEntry` in the domain owns the rule
 * that a `FINE` cannot be positive, and it has to: the booking module appends rows without ever
 * passing through this schema, so a sign rule enforced only at HTTP would be enforced on one of
 * the two doors.
 */
export const grantWalletEntrySchema = z
  .object({
    entry_type: z.enum(['CREDIT_GRANT', 'FINE', 'ADJUSTMENT']),
    /*
     * Capped at ₹1,00,000 in either direction. Not a business rule — a guard against a fat-fingered
     * extra zero on a screen whose whole job is moving somebody's money.
     */
    amount_paise: z.number().int().min(-10_000_000).max(10_000_000),
    note: z.string().trim().min(1).max(500),
  })
  .strict();

export const customerIdParamSchema = z.object({ id: z.string().min(1) });

export type GrantWalletEntryBody = z.input<typeof grantWalletEntrySchema>;
