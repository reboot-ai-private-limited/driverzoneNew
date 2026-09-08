import { z } from 'zod';

/**
 * Validates request to manually adjust a driver's ledger balance.
 * Conforms to AdminAdjustDriverWalletRequest in @driverzone/contracts.
 */
export const adjustDriverWalletSchema = z
  .object({
    type: z.enum(['ADJUSTMENT', 'PENALTY', 'BONUS']),
    amount_paise: z.number().int().min(-10_000_000).max(10_000_000),
    note: z.string().trim().min(1).max(500),
  })
  .refine(
    (data) => {
      if (data.type === 'BONUS') return data.amount_paise > 0;
      if (data.type === 'PENALTY') return data.amount_paise < 0;
      if (data.type === 'ADJUSTMENT') return data.amount_paise !== 0;
      return true;
    },
    {
      message:
        'amount_paise must be positive for BONUS, negative for PENALTY, and non-zero for ADJUSTMENT',
      path: ['amount_paise'],
    },
  );

export type AdjustDriverWalletInput = z.infer<typeof adjustDriverWalletSchema>;

/**
 * Validates request to disburse a payout to a driver.
 */
export const createPayoutSchema = z.object({
  driver_id: z.string().min(1),
  amount_paise: z.number().int().positive().optional(),
  utr: z.string().trim().min(1).max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export type CreatePayoutInput = z.infer<typeof createPayoutSchema>;

/**
 * Validates query parameters when listing payouts.
 */
export const payoutQuerySchema = z.object({
  driver_id: z.string().optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'PAID', 'FAILED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .transform((v) => (v ? new Date(`${v}T00:00:00.000Z`) : undefined)),
  to_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .transform((v) => (v ? new Date(`${v}T23:59:59.999Z`) : undefined)),
});

export type PayoutQueryInput = z.infer<typeof payoutQuerySchema>;
