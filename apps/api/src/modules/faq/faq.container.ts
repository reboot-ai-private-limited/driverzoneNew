import type { Router } from 'express';
import type { Role } from '@driverzone/contracts';
import { MongoFaqRepository } from './infrastructure/faq.repository.impl.js';
import { FaqAuditLog } from './infrastructure/audit.faq.js';
import { ListFaqsUseCase } from './application/useCases/listFaqs.usecase.js';
import { ListPublishedFaqsUseCase } from './application/useCases/listPublishedFaqs.usecase.js';
import { ReplaceFaqsUseCase } from './application/useCases/replaceFaqs.usecase.js';
import {
  makeListFaqsController,
  makePublishedFaqsController,
  makeReplaceFaqsController,
} from './interface/faq.controller.js';
import { buildAdminRouter, buildAudienceRouter } from './interface/faq.routes.js';
import { registerFaqSwaggerPaths } from './interface/faq.swagger.js';

/**
 * Tier 0 — this module imports no other. It is content: nothing in the API reads an FAQ to decide
 * anything, which is also why there is no `faq.public.ts`. The day something does, the answer is
 * almost certainly that the value belongs in the settings registry instead.
 *
 * NO CACHE, unlike settings. Settings are read inside fare calculations on the hot path; FAQs are
 * read when someone opens a help screen. A cache here would buy nothing and cost an admin the
 * confidence that what they just saved is what the apps now show.
 */
export interface FaqContainer {
  buildAdminRouter: () => Router;
  buildAudienceRouter: (role: Extract<Role, 'CUSTOMER' | 'DRIVER'>) => Router;
}

export function buildFaqContainer(): FaqContainer {
  const repo = new MongoFaqRepository();
  const audit = new FaqAuditLog();

  const list = new ListFaqsUseCase(repo);
  const published = new ListPublishedFaqsUseCase(repo);
  const replace = new ReplaceFaqsUseCase(repo, audit);

  registerFaqSwaggerPaths();

  return {
    buildAdminRouter: () =>
      buildAdminRouter({
        list: makeListFaqsController(list),
        replace: makeReplaceFaqsController(replace),
      }),
    buildAudienceRouter: (role) => buildAudienceRouter(role, makePublishedFaqsController(published)),
  };
}
