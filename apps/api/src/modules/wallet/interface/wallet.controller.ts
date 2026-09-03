import type { Request, RequestHandler } from 'express';
import { AppError } from '../../../shared/errors/AppError.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import type { ManageWalletUseCase } from '../application/useCases/manageWallet.usecase.js';
import { toCustomerWalletDto } from './wallet.mapper.js';
import { customerIdParamSchema, grantWalletEntrySchema } from './wallet.validation.js';

function principalOf(req: Request): string {
  const sub = req.principal?.sub;
  if (sub === undefined) {
    throw AppError.internal('INTERNAL', {
      reason: 'requireAuth ran but left no principal on the request',
    });
  }
  return sub;
}

/**
 * `GET /customer/wallet` — the caller's own balance and statement.
 *
 * SCOPED BY THE TOKEN. There is no id in the path, so there is no shape of this request that
 * reads somebody else's wallet.
 */
export function makeGetMyWalletController(useCase: ManageWalletUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const view = await useCase.view(principalOf(req));

    sendSuccess(req, res, toCustomerWalletDto(view), 'Your wallet');
  });
}

/**
 * `GET /admin/customers/:id/wallet` — an admin looking at somebody's wallet.
 *
 * An unknown customer id answers with a zero balance and an empty statement rather than a 404,
 * for the reason the driver wallet does the same: this module is tier 2 and cannot ask `identity`
 * whether the customer exists, and "no entries" is a true statement about any id.
 */
export function makeAdminGetWalletController(useCase: ManageWalletUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = customerIdParamSchema.parse(req.params);

    sendSuccess(req, res, toCustomerWalletDto(await useCase.view(id)), 'Customer wallet');
  });
}

/**
 * `POST /admin/customers/:id/wallet` — the only way credit or a fine enters a wallet.
 *
 * ONE ENDPOINT FOR BOTH DIRECTIONS. Granting ₹100 and fining ₹100 are the same operation with
 * the same audit requirement, and two endpoints would be two places to get the sign wrong. The
 * domain refuses a sign that contradicts the type, so a `FINE` sent as a positive number is a 400
 * rather than an accidental gift.
 *
 * NOT ATTACHED TO A BOOKING. An admin acting on this endpoint is acting on the customer, not on a
 * trip — a fine that belongs to a specific booking is written by the booking side effect that
 * knows which one, and passing a booking id here would let an admin write a second row that the
 * once-per-booking index was meant to prevent.
 */
export function makeAdminGrantWalletController(useCase: ManageWalletUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = customerIdParamSchema.parse(req.params);
    const body = grantWalletEntrySchema.parse(req.body);

    const [entry] = await useCase.append([
      {
        customerId: id,
        entryType: body.entry_type,
        amountPaise: body.amount_paise,
        note: body.note,
      },
    ]);

    if (entry === undefined) {
      // `append` only returns fewer rows than it was given when the idempotency index rejected
      // one, and none of the three types this endpoint accepts is in that index — so this is a
      // real fault rather than a replay, and it must not answer 200.
      throw AppError.internal('INTERNAL', { reason: 'wallet entry was not written' });
    }

    sendSuccess(
      req,
      res,
      toCustomerWalletDto(await useCase.view(id)),
      body.amount_paise >= 0 ? 'Credit added' : 'Charge added',
      201,
    );
  });
}
