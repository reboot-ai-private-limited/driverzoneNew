import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  TRANSACTION_TYPES,
  type AdminAdjustDriverWalletResponse,
  type AdminCreatePayoutResponse,
  type AdminListPayoutsResponse,
} from '@driverzone/contracts';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { isoDaySchema, istDayStart, istNextDayStart } from '../../../shared/http/istDay.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import type { GetDriverWalletUseCase } from '../application/useCases/getDriverWallet.usecase.js';
import type { AdjustDriverWalletUseCase } from '../application/useCases/adjustDriverWallet.usecase.js';
import type { ProcessPayoutUseCase } from '../application/useCases/processPayout.usecase.js';
import type { ListPayoutsUseCase } from '../application/useCases/listPayouts.usecase.js';
import type { LedgerQuery } from '../domain/ledgerRepository.port.js';
import { toWalletDto, toEntryDto, toPayoutDto } from './ledger.mapper.js';
import {
  adjustDriverWalletSchema,
  createPayoutSchema,
  payoutQuerySchema,
} from './ledger.validation.js';

const walletQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  /**
   * `?type=TRIP_EARNING,BONUS`. Parsed against the enum rather than passed through, so a typo is
   * a 400 rather than a filter that silently matches nothing and reads as "you earned nothing".
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
    .pipe(z.array(z.enum(TRANSACTION_TYPES)).min(1).optional()),
  from: isoDaySchema.optional(),
  to: isoDaySchema.optional(),
  from_date: isoDaySchema.optional(),
  to_date: isoDaySchema.optional(),
});

/** Turns the parsed query into the repository's shape: an inclusive `to` day becomes exclusive. */
function toLedgerQuery(parsed: z.infer<typeof walletQuerySchema>): LedgerQuery | undefined {
  const from = parsed.from ?? parsed.from_date;
  const to = parsed.to ?? parsed.to_date;
  if (parsed.type === undefined && from === undefined && to === undefined) {
    return undefined;
  }

  return {
    ...(parsed.type === undefined ? {} : { types: parsed.type }),
    ...(from === undefined ? {} : { from: istDayStart(from) }),
    // The day AFTER the one named, so `to=2026-09-04` includes everything that happened on the 4th.
    ...(to === undefined ? {} : { to: istNextDayStart(to) }),
  };
}

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
    const parsed = walletQuerySchema.parse(req.query);
    const { page, limit } = parsed;

    const wallet = await useCase.execute(id, page, limit, toLedgerQuery(parsed));

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

/**
 * `GET /driver/wallet` — the same read, for the driver themselves.
 *
 * THE ID COMES FROM THE TOKEN, never from the path or the query. A driver-supplied id would make
 * this an authorisation decision on every request, and the one it has to get right is the one it
 * would be easiest to get wrong: reading another driver's earnings. There is no id to tamper
 * with here, so there is no check to forget.
 *
 * Shares `toWalletDto` with the admin controller above, so the running balance a driver sees is
 * derived by the same code as the one an admin quotes back to them.
 */
export function makeMyWalletController(useCase: GetDriverWalletUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    // `requireAuth('DRIVER')` runs before this and rejects an absent principal, so by here it is
    // set — the fallback keeps TypeScript honest rather than describing a reachable state.
    const driverId = req.principal?.sub ?? '';
    const parsed = walletQuerySchema.parse(req.query);
    const { page, limit } = parsed;

    const wallet = await useCase.execute(driverId, page, limit, toLedgerQuery(parsed));

    sendSuccess(req, res, toWalletDto(driverId, wallet, page, limit), 'Earnings retrieved');
  });
}
