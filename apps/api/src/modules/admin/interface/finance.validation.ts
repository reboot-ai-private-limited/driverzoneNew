import { z } from 'zod';
import {
  CUSTOMER_WALLET_STATES,
  DRIVER_BALANCE_SORTS,
  DRIVER_BALANCE_STATES,
  FINANCE_PARTY_FILTERS,
  TRANSACTION_TYPES,
} from '@driverzone/contracts';
import { isoDaySchema } from '../../../shared/http/istDay.js';

/**
 * `GET /admin/finance/driver-balances`.
 *
 * Query params arrive as strings, so every number is transformed and every enum is parsed
 * against the real list rather than passed through — a typo has to be a 400. Silently ignoring
 * `state=OWED_TO_COMPNY` would answer a different question and look like an empty result set.
 *
 * `limit` caps at 100, matching every other admin list in this API.
 */
export const driverBalancesQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .refine((n) => !Number.isNaN(n) && n >= 1, 'Page must be >= 1'),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .refine((n) => !Number.isNaN(n) && n >= 1 && n <= 100, 'Limit must be between 1 and 100'),
  search: z.string().trim().max(120).optional(),
  state: z.enum(DRIVER_BALANCE_STATES).optional(),
  /** `?suspended=true`. Absent means "no restriction", not "false". */
  suspended: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /**
   * In PAISE, not rupees. Every money value on this API's wire is paise (docs/LLD A3), and a
   * parameter that broke that rule would be the one place an admin had to know the difference.
   */
  min_owed_paise: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : parseInt(v, 10)))
    .refine((n) => n === undefined || (!Number.isNaN(n) && n >= 0), 'min_owed_paise must be >= 0'),
  sort: z.enum(DRIVER_BALANCE_SORTS).optional(),
});

/**
 * `GET /admin/finance/transactions`.
 *
 * DRIVER-SIDE ONLY FOR NOW. The contract's `FinanceTransactionDto` has a `party` discriminator
 * because the feed is meant to cover the customer wallet too, but `wallet` has no cross-customer
 * query yet. It arrives with the wallet aggregation.
 *
 * `party` AND `customer_id` ARE DECLARED HERE PRECISELY BECAUSE THEY ARE UNSUPPORTED. Omitting
 * them looked like the careful choice and was the opposite: Zod strips unknown keys by default,
 * so `?party=CUSTOMER` was accepted, silently dropped, and answered with DRIVER rows and a 200.
 * A filter that quietly answers a different question is worse than one that refuses — the caller
 * has no way to tell, and these are money screens. Declared and rejected, the failure is loud.
 */
export const financeTransactionsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .refine((n) => !Number.isNaN(n) && n >= 1, 'Page must be >= 1'),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 25))
    .refine((n) => !Number.isNaN(n) && n >= 1 && n <= 100, 'Limit must be between 1 and 100'),
  search: z.string().trim().max(120).optional(),
  /** Pins the feed to one driver — the "show me everything behind this balance" link. */
  driver_id: z.string().min(1).optional(),
  /**
   * `DRIVER` is the only supported value, and it is a no-op — the feed is already driver-side.
   * `CUSTOMER` and `ALL` are 400s until the customer wallet joins the feed.
   */
  party: z
    .enum(FINANCE_PARTY_FILTERS)
    .optional()
    .refine(
      (value) => value === undefined || value === 'DRIVER',
      'Only party=DRIVER is supported: the transactions feed does not cover customer wallets yet. Customer balances are on GET /admin/finance/customer-wallets, and one customer’s statement is on GET /admin/customers/:id/wallet.',
    ),
  /** Rejected rather than ignored, for the reason in the docblock. */
  customer_id: z
    .string()
    .optional()
    .refine(
      (value) => value === undefined,
      'customer_id is not supported: the transactions feed is driver-side only. Use GET /admin/customers/:id/wallet for one customer’s statement.',
    ),
  /**
   * Comma-separated. An unknown type is a 400 rather than a silently-dropped filter: ignoring it
   * would answer a different question and look identical to "there is nothing here".
   */
  type: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.split(',')))
    .refine(
      (list) =>
        list === undefined || list.every((t) => (TRANSACTION_TYPES as readonly string[]).includes(t)),
      'Unknown transaction type',
    ),
  from: isoDaySchema.optional(),
  to: isoDaySchema.optional(),
});

/** `GET /admin/finance/customer-wallets`. */
export const customerWalletsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .refine((n) => !Number.isNaN(n) && n >= 1, 'Page must be >= 1'),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .refine((n) => !Number.isNaN(n) && n >= 1 && n <= 100, 'Limit must be between 1 and 100'),
  search: z.string().trim().max(120).optional(),
  state: z.enum(CUSTOMER_WALLET_STATES).optional(),
  sort: z.enum(['BALANCE_ASC', 'BALANCE_DESC', 'LAST_ACTIVITY_DESC']).optional(),
});

/** `POST /admin/finance/drivers/:id/settle`. */
export const settleDriverSchema = z
  .object({
    /**
     * A POSITIVE magnitude in paise. The direction is the server's to decide from the driver's
     * current balance — a client that could choose would eventually choose wrong, and the wrong
     * choice is a permanent row saying money moved the way it did not.
     */
    amount_paise: z.number().int().positive('The amount must be a positive number of paise'),
    note: z.string().trim().min(1, 'A settlement needs a note saying what it was').max(500),
    reference: z.string().trim().max(120).optional(),
  })
  .strict();

/** Own copy rather than identity's — that one is internal to its module and closed to this one. */
export const driverIdParamSchema = z.object({ id: z.string().min(1) });
