import type { RequestHandler } from 'express';
import { z } from 'zod';
import type {
  AdminAdjustDriverWalletResponse,
  AdminCreatePayoutResponse,
  AdminListPayoutsResponse,
} from '@driverzone/contracts';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import type { GetDriverWalletUseCase } from '../application/useCases/getDriverWallet.usecase.js';
import type { AdjustDriverWalletUseCase } from '../application/useCases/adjustDriverWallet.usecase.js';
import type { ProcessPayoutUseCase } from '../application/useCases/processPayout.usecase.js';
import type { ListPayoutsUseCase } from '../application/useCases/listPayouts.usecase.js';
import { toWalletDto, toEntryDto, toPayoutDto } from './ledger.mapper.js';
import {
  adjustDriverWalletSchema,
  createPayoutSchema,
  payoutQuerySchema,
} from './ledger.validation.js';

const walletQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
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

const driverIdParamSchema = z.object({ id: z.string().min(1) });

/**
 * `GET /admin/drivers/:id/wallet`.
 *
 * An unknown driver id answers with a zero balance and an empty statement rather than a 404, and
 * that is deliberate: `ledger` is tier 2 and cannot ask `identity` whether a driver exists, and
 * "this driver has no ledger entries" is a true statement about any id. The screen reaches here
 * from a driver detail page that has already established the driver is real.
 */
export function makeDriverWalletController(useCase: GetDriverWalletUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = driverIdParamSchema.parse(req.params);
    const { page, limit, from_date, to_date } = walletQuerySchema.parse(req.query);

    const wallet = await useCase.execute(id, page, limit, from_date, to_date);

    sendSuccess(req, res, toWalletDto(id, wallet, page, limit), 'Driver wallet retrieved');
  });
}

/**
 * `POST /admin/drivers/:id/wallet/adjustment`
 *
 * Appends an ADJUSTMENT, PENALTY, or BONUS entry to the driver's ledger and returns
 * the created entry along with the driver's new balance.
 */
export function makeAdjustDriverWalletController(useCase: AdjustDriverWalletUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = driverIdParamSchema.parse(req.params);
    const body = adjustDriverWalletSchema.parse(req.body);

    const { entry, newBalancePaise } = await useCase.execute({
      driverId: id,
      type: body.type,
      amountPaise: body.amount_paise,
      note: body.note,
    });

    const response: AdminAdjustDriverWalletResponse = {
      entry: toEntryDto(id, entry, newBalancePaise),
      new_balance_paise: newBalancePaise,
    };

    sendSuccess(req, res, response, 'Wallet balance adjusted', 201);
  });
}

/**
 * `POST /admin/payouts`
 *
 * Disburses a settlement to a driver, creating a Payout record and debiting the driver's ledger with PAYOUT.
 */
export function makeCreatePayoutController(useCase: ProcessPayoutUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const body = createPayoutSchema.parse(req.body);

    const { payout, ledgerEntry, newBalancePaise } = await useCase.execute({
      driverId: body.driver_id,
      amountPaise: body.amount_paise,
      utr: body.utr,
      notes: body.notes,
    });

    const response: AdminCreatePayoutResponse = {
      payout: toPayoutDto(payout),
      ledger_entry: toEntryDto(body.driver_id, ledgerEntry, newBalancePaise),
      new_balance_paise: newBalancePaise,
    };

    sendSuccess(req, res, response, 'Payout processed successfully', 201);
  });
}

/**
 * `GET /admin/payouts`
 *
 * Lists driver payouts with pagination and optional filtering by driver_id, status, and date range.
 */
export function makeListPayoutsController(useCase: ListPayoutsUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const query = payoutQuerySchema.parse(req.query);

    const result = await useCase.execute(
      {
        driverId: query.driver_id,
        status: query.status,
        fromDate: query.from_date,
        toDate: query.to_date,
      },
      query.page,
      query.limit,
    );

    const response: AdminListPayoutsResponse = {
      payouts: result.payouts.map(toPayoutDto),
      pagination: {
        page: result.page,
        limit: result.limit,
        total_items: result.totalItems,
        total_pages: result.totalPages,
      },
    };

    sendSuccess(req, res, response, 'Payouts retrieved successfully');
  });
}


