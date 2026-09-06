import { z } from 'zod';
import { WALLET_ENTRY_TYPES } from '@driverzone/contracts';
import { isoDaySchema, istDayStart, istNextDayStart } from '../../../shared/http/istDay.js';
import type { WalletQuery } from '../domain/walletRepository.port.js';

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

/**
 * The filters `GET /admin/customers/:id/wallet` accepts. Deliberately the same shape, the same
 * defaults and the same ceiling as the driver statement's — two money statements in one admin
 * panel that page differently is a difference somebody has to hold in their head for no gain.
 */
export const customerWalletQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  /**
   * `?type=CREDIT_GRANT,FINE`. Parsed against the enum rather than passed through, so a typo is a
   * 400 rather than a filter that silently matches nothing and reads as "no activity".
   */
  type: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part !== ''),
    )
    .pipe(z.array(z.enum(WALLET_ENTRY_TYPES)).min(1).optional()),
  from: isoDaySchema.optional(),
  to: isoDaySchema.optional(),
});

/** Turns the parsed query into the repository's shape: an inclusive `to` day becomes exclusive. */
export function toWalletQuery(
  parsed: z.infer<typeof customerWalletQuerySchema>,
): WalletQuery | undefined {
  if (parsed.type === undefined && parsed.from === undefined && parsed.to === undefined) {
    return undefined;
  }

  return {
    ...(parsed.type === undefined ? {} : { types: parsed.type }),
    ...(parsed.from === undefined ? {} : { from: istDayStart(parsed.from) }),
    ...(parsed.to === undefined ? {} : { to: istNextDayStart(parsed.to) }),
  };
}
