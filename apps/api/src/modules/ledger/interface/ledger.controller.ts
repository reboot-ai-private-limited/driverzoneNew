import type { RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import type { GetDriverWalletUseCase } from '../application/useCases/getDriverWallet.usecase.js';
import { toWalletDto } from './ledger.mapper.js';

const walletQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
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
    const { page, limit } = walletQuerySchema.parse(req.query);

    const wallet = await useCase.execute(id, page, limit);

    sendSuccess(req, res, toWalletDto(id, wallet, page, limit), 'Driver wallet retrieved');
  });
}
