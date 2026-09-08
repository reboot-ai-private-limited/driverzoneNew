import type { Request, RequestHandler } from 'express';
import { AppError } from '../../../shared/errors/AppError.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/response.util.js';
import type {
  AccountDirectoryContract,
  CustomerContactContract,
  DriverCardContract,
} from '../../identity/identity.public.js';
import type { LedgerEntryType, LedgerFinanceContract } from '../../ledger/ledger.public.js';
import { istDayStart, istNextDayStart } from '../../../shared/http/istDay.js';
import { toMoney } from '../../../shared/money/format.js';
import type { WalletFinanceContract } from '../../wallet/wallet.public.js';
import {
  toDriverBalanceRowDto,
  toDriverBalanceTotalsDto,
  toCustomerWalletRowDto,
  toFinanceTransactionDto,
} from './finance.mapper.js';
import {
  driverBalancesQuerySchema,
  customerWalletsQuerySchema,
  driverIdParamSchema,
  settleDriverSchema,
  financeTransactionsQuerySchema,
} from './finance.validation.js';

/**
 * How many accounts a name-or-number search may resolve to before the query stops widening.
 *
 * The same cap and the same reasoning as the bookings list: a one-letter search matches most of
 * the driver table, and every id it returns is spliced into an `$in`.
 */
const SEARCH_ACCOUNT_LIMIT = 200;

/**
 * `GET /admin/finance/driver-balances` — the collections view.
 *
 * THE JOIN HAPPENS HERE, and it is the reason this module exists. Balances live in `ledger`,
 * names and numbers live in `identity`, and those are different tiers that may not read each
 * other's collections. So `ledger` pages its OWN rows (which is what makes `total_items` honest)
 * and this controller resolves names for the page only — one batched lookup, never one per row.
 *
 * A consequence worth stating plainly: THERE IS NO SORT BY NAME. The pager sorts in the
 * collection it pages, and the name is not in it. Sorting by name would mean loading every
 * matching driver to sort them, which stops being possible at exactly the scale where sorting
 * matters. Name is a search here, not a sort.
 */
export function makeDriverBalancesController(
  ledger: LedgerFinanceContract,
  directory: AccountDirectoryContract & DriverCardContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const query = driverBalancesQuerySchema.parse(req.query);

    /*
     * `undefined` and `[]` are different answers and the repository treats them differently:
     * no search means every driver, a search that matched nobody means nobody. Collapsing the
     * two would make a search for a nonexistent name return the entire collections list.
     */
    const driverIds =
      query.search === undefined || query.search === ''
        ? undefined
        : await directory.idsMatching('DRIVER', query.search, SEARCH_ACCOUNT_LIMIT);

    const result = await ledger.driverBalances(
      {
        ...(driverIds === undefined ? {} : { driverIds }),
        ...(query.state === undefined || query.state === 'ALL' ? {} : { state: query.state }),
        ...(query.suspended === undefined ? {} : { suspendedOnly: query.suspended }),
        ...(query.min_owed_paise === undefined ? {} : { minOwedPaise: query.min_owed_paise }),
        ...(query.sort === undefined ? {} : { sort: query.sort }),
      },
      query.page,
      query.limit,
    );

    // One lookup for the page, deduped. `driverCardsByIds` carries the phone, which is the point:
    // collections work is somebody picking up a phone.
    const cards = await directory.driverCardsByIds(result.rows.map((row) => row.driverId));

    sendSuccess(
      req,
      res,
      {
        rows: result.rows.map((row) => {
          const card = cards.get(row.driverId);
          return toDriverBalanceRowDto(
            row,
            card === undefined ? undefined : { fullName: card.fullName, phone: card.phone },
          );
        }),
        totals: toDriverBalanceTotalsDto(result.totals),
        pagination: {
          page: query.page,
          limit: query.limit,
          total_items: result.totalItems,
          total_pages: Math.max(1, Math.ceil(result.totalItems / query.limit)),
        },
      },
      'Driver balances',
    );
  });
}

/**
 * `GET /admin/finance/transactions` — every money movement, newest first.
 *
 * DRIVER-SIDE ONLY until `wallet` grows a cross-customer query. The DTO already carries a `party`
 * discriminator and a normalised `direction` so customer rows can join this table without
 * changing its shape — the column that stops a mixed feed from lying about which way money went.
 *
 * NO RUNNING BALANCE, unlike a single driver's statement. Across accounts a cumulative balance
 * has no owner, and computing it would mean a window function over the entire collection rather
 * than one driver's slice. The drill-down to a driver is where that number lives.
 */
export function makeFinanceTransactionsController(
  ledger: LedgerFinanceContract,
  directory: AccountDirectoryContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const query = financeTransactionsQuerySchema.parse(req.query);

    // Same `undefined` vs `[]` distinction as the balances list: no search means everyone, a
    // search that matched nobody means nobody.
    const driverIds =
      query.search === undefined || query.search === ''
        ? undefined
        : await directory.idsMatching('DRIVER', query.search, SEARCH_ACCOUNT_LIMIT);

    const result = await ledger.feed(query.page, query.limit, {
      ...(query.driver_id === undefined ? {} : { driverId: query.driver_id }),
      ...(driverIds === undefined ? {} : { driverIds }),
      ...(query.type === undefined ? {} : { types: query.type as LedgerEntryType[] }),
      ...(query.from === undefined ? {} : { from: istDayStart(query.from) }),
      // Inclusive day → exclusive instant, so a row at 23:59 on the `to` date is still inside.
      ...(query.to === undefined ? {} : { to: istNextDayStart(query.to) }),
    });

    const names = await directory.namesByIds('DRIVER', [
      ...new Set(result.entries.map((entry) => entry.driverId)),
    ]);

    sendSuccess(
      req,
      res,
      {
        entries: result.entries.map((entry) =>
          toFinanceTransactionDto(entry, { fullName: names.get(entry.driverId) ?? null, phone: null }),
        ),
        summary: {
          credited_paise: result.totals.creditedPaise,
          debited_paise: result.totals.debitedPaise,
          net_paise: result.totals.creditedPaise - result.totals.debitedPaise,
          count: result.totals.count,
        },
        pagination: {
          page: query.page,
          limit: query.limit,
          total_items: result.totalItems,
          total_pages: Math.max(1, Math.ceil(result.totalItems / query.limit)),
        },
      },
      'Finance transactions',
    );
  });
}

/**
 * `GET /admin/finance/customer-wallets` — customers holding credit or carrying a fee.
 *
 * The mirror of the driver balances list, joining `wallet` with `identity` for the same reason:
 * balances live in one module, names in another, and they are different tiers.
 */
export function makeCustomerWalletsController(
  wallet: WalletFinanceContract,
  directory: AccountDirectoryContract & CustomerContactContract,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const query = customerWalletsQuerySchema.parse(req.query);

    const customerIds =
      query.search === undefined || query.search === ''
        ? undefined
        : await directory.idsMatching('CUSTOMER', query.search, SEARCH_ACCOUNT_LIMIT);

    const result = await wallet.customerWallets(
      {
        ...(customerIds === undefined ? {} : { customerIds }),
        ...(query.state === undefined || query.state === 'ALL' ? {} : { state: query.state }),
        ...(query.sort === undefined ? {} : { sort: query.sort }),
      },
      query.page,
      query.limit,
    );

    // `customerContactsByIds` rather than `namesByIds`: ops calls customers about unpaid fees,
    // and the admin customer directory already shows numbers.
    const contacts = await directory.customerContactsByIds(result.rows.map((row) => row.customerId));

    sendSuccess(
      req,
      res,
      {
        rows: result.rows.map((row) => {
          const contact = contacts.get(row.customerId);
          return toCustomerWalletRowDto(
            row,
            contact === undefined ? undefined : { fullName: contact.fullName, phone: contact.phone },
          );
        }),
        totals: {
          customers_in_debt: result.totals.customersInDebt,
          total_owed_by_customers: toMoney(result.totals.totalOwedByCustomersPaise),
          customers_in_credit: result.totals.customersInCredit,
          total_credit_outstanding: toMoney(result.totals.totalCreditOutstandingPaise),
          customers: result.totals.customers,
        },
        pagination: {
          page: query.page,
          limit: query.limit,
          total_items: result.totalItems,
          total_pages: Math.max(1, Math.ceil(result.totalItems / query.limit)),
        },
      },
      'Customer wallets',
    );
  });
}

/**
 * The `Idempotency-Key` header, required.
 *
 * Generated server-side when missing would defeat the point entirely: the whole mechanism depends
 * on the key being STABLE across a client's retries, and a per-request key is no key at all.
 * Same rule, and the same wording, as the booking create endpoint.
 */
function idempotencyKeyOf(req: Request): string {
  const key = req.get('idempotency-key');
  if (key === undefined || key.trim() === '') {
    throw AppError.badRequest('An Idempotency-Key header is required on this request.');
  }
  return key.trim();
}

/**
 * `POST /admin/finance/drivers/:id/settle` — record that a balance was cleared.
 *
 * THE ONLY WRITE ON THE FINANCE SURFACE. Everything else here reads. It appends exactly one
 * ledger row and cannot edit or remove one, because the ledger port cannot express either — a
 * settlement entered wrongly is corrected with an `ADJUSTMENT`, never deleted.
 *
 * Returns the settlement and the balance either side of it, NOT the refreshed statement. Building
 * that here would mean importing `ledger`'s own wallet mapper, which is internal to that module
 * and closed to this one — and the client already holds a wallet query it can invalidate, which
 * is both less coupling and one fewer thing to keep in agreement.
 */
export function makeSettleDriverController(ledger: LedgerFinanceContract): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = driverIdParamSchema.parse(req.params);
    const body = settleDriverSchema.parse(req.body);

    const result = await ledger.settleDriver({
      driverId: id,
      amountPaise: body.amount_paise,
      note: body.note,
      ...(body.reference === undefined ? {} : { reference: body.reference }),
      idempotencyKey: idempotencyKeyOf(req),
    });

    sendSuccess(
      req,
      res,
      {
        entry_id: result.entry.id,
        type: result.entry.entryType,
        amount: toMoney(result.entry.amountPaise),
        balance_before: toMoney(result.balanceBeforePaise),
        balance_after: toMoney(result.balanceAfterPaise),
      },
      result.entry.entryType === 'DEBT_COLLECTED' ? 'Payment recorded' : 'Payout recorded',
    );
  });
}
