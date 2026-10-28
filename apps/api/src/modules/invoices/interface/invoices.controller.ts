import type { Request, RequestHandler } from 'express';
import type { CustomerGstInvoiceResponse } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { CustomerContactContract } from '../../identity/identity.public.js';
import type { GetGstInvoiceForTripUseCase } from '../application/useCases/getGstInvoiceForTrip.usecase.js';
import type { RequestGstInvoiceUseCase } from '../application/useCases/requestGstInvoice.usecase.js';
import type { ResolveGstInvoiceUseCase } from '../application/useCases/resolveGstInvoice.usecase.js';
import type { GstInvoiceRepositoryPort } from '../domain/gstInvoiceRepository.port.js';
import {
  toAdminGstInvoiceRequestDto,
  toBillingDetailsDto,
  toGstInvoiceRequestDto,
} from './invoices.mapper.js';
import {
  adminListQuery,
  createGstInvoiceSchema,
  idParam,
  resolveGstInvoiceSchema,
} from './invoices.validation.js';

/** The admin queue is small — a few requests a day — so one page of the newest is the whole list. */
const ADMIN_PAGE_SIZE = 200;

function principalOf(req: Request): string {
  const sub = req.principal?.sub;
  if (sub === undefined) {
    throw AppError.internal('INTERNAL', {
      reason: 'requireAuth ran but left no principal on the request',
    });
  }
  return sub;
}

export interface CustomerInvoicesControllers {
  getForTrip: RequestHandler;
  request: RequestHandler;
}

export interface AdminInvoicesControllers {
  list: RequestHandler;
  resolve: RequestHandler;
}

/** INTERFACE — HTTP in, HTTP out. Every policy question is answered a layer down. */
export function makeCustomerInvoicesControllers(
  getForTrip: GetGstInvoiceForTripUseCase,
  requestInvoice: RequestGstInvoiceUseCase,
): CustomerInvoicesControllers {
  return {
    getForTrip: asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const result = await getForTrip.execute({ customerId: principalOf(req), bookingId: id });

      const body: CustomerGstInvoiceResponse = {
        request: result.request === null ? null : toGstInvoiceRequestDto(result.request),
        prefill: result.prefill === null ? null : toBillingDetailsDto(result.prefill),
      };
      sendSuccess(req, res, body);
    }),

    request: asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const body = createGstInvoiceSchema.parse(req.body);

      const created = await requestInvoice.execute({
        customerId: principalOf(req),
        bookingId: id,
        gstin: body.gstin,
        legalName: body.legal_name,
        billingAddress: body.billing_address,
        pincode: body.pincode,
        sendToWhatsapp: body.send_to_whatsapp,
        sendToEmail: body.send_to_email,
      });

      sendSuccess(
        req,
        res,
        toGstInvoiceRequestDto(created),
        'We have received your request. Your GST invoice will be generated and sent to you within the next working days.',
        201,
      );
    }),
  };
}

export function makeAdminInvoicesControllers(
  repo: GstInvoiceRepositoryPort,
  resolveInvoice: ResolveGstInvoiceUseCase,
  directory: CustomerContactContract,
): AdminInvoicesControllers {
  return {
    list: asyncHandler(async (req, res) => {
      const q = adminListQuery.parse(req.query);
      const requests = await repo.listForAdmin({ status: q.status }, ADMIN_PAGE_SIZE);

      // One lookup for the whole page, deduped — not a query per row.
      const contacts = await directory.customerContactsByIds([...new Set(requests.map((r) => r.customerId))]);
      sendSuccess(
        req,
        res,
        requests.map((request) => toAdminGstInvoiceRequestDto(request, contacts.get(request.customerId))),
      );
    }),

    resolve: asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const body = resolveGstInvoiceSchema.parse(req.body);

      const resolved = await resolveInvoice.execute({
        id,
        adminId: principalOf(req),
        status: body.status,
        invoiceNumber: body.invoice_number,
        note: body.note,
      });

      const contacts = await directory.customerContactsByIds([resolved.customerId]);
      sendSuccess(
        req,
        res,
        toAdminGstInvoiceRequestDto(resolved, contacts.get(resolved.customerId)),
        body.status === 'SENT' ? 'Marked as sent' : 'Request rejected',
      );
    }),
  };
}
