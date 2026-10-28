import type { Router } from 'express';
import type { BookingInvoiceContract } from '../bookings/bookings.public.js';
import type { CustomerContactContract } from '../identity/identity.public.js';
import { GetGstInvoiceForTripUseCase } from './application/useCases/getGstInvoiceForTrip.usecase.js';
import { RequestGstInvoiceUseCase } from './application/useCases/requestGstInvoice.usecase.js';
import { ResolveGstInvoiceUseCase } from './application/useCases/resolveGstInvoice.usecase.js';
import { MongoGstInvoiceRepository } from './infrastructure/gstInvoiceRepository.impl.js';
import {
  makeAdminInvoicesControllers,
  makeCustomerInvoicesControllers,
} from './interface/invoices.controller.js';
import { buildAdminInvoicesRouter, buildCustomerInvoicesRouter } from './interface/invoices.routes.js';
import { registerInvoicesSwaggerPaths } from './interface/invoices.swagger.js';

export interface InvoicesDependencies {
  /** Read-only. A request needs to know the trip finished and whose it was, and nothing else. */
  bookings: BookingInvoiceContract;
  /** Names and numbers for the admin queue. */
  identity: CustomerContactContract;
}

export interface InvoicesContainer {
  buildCustomerRouter: () => Router;
  buildAdminRouter: () => Router;
}

export function buildInvoicesContainer(deps: InvoicesDependencies): InvoicesContainer {
  registerInvoicesSwaggerPaths();

  const repo = new MongoGstInvoiceRepository();
  const customer = makeCustomerInvoicesControllers(
    new GetGstInvoiceForTripUseCase(repo, deps.bookings),
    new RequestGstInvoiceUseCase(repo, deps.bookings),
  );
  const admin = makeAdminInvoicesControllers(repo, new ResolveGstInvoiceUseCase(repo), deps.identity);

  return {
    buildCustomerRouter: () => buildCustomerInvoicesRouter(customer),
    buildAdminRouter: () => buildAdminInvoicesRouter(admin),
  };
}
