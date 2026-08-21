import type { RequestHandler } from 'express';
import { sendSuccess } from '@/shared/http/response.util.js';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import type { GetHealthUseCase } from '../application/useCases/getHealth.usecase.js';

/**
 * INTERFACE — translates HTTP to a use-case call and back. Contains no rules.
 *
 * A factory taking its use case as an argument rather than importing a singleton: the
 * container decides what this controller runs against, so a test can hand it a fake without
 * module mocking.
 */
export function makeGetHealthController(useCase: GetHealthUseCase): RequestHandler {
  return asyncHandler(async (req, res) => {
    const report = await useCase.execute();

    // 503 when degraded so a load balancer takes this instance out of rotation. A 200 with
    // `status: "degraded"` in the body reads fine to a human and is invisible to every
    // orchestrator in existence.
    sendSuccess(req, res, report, 'Health check', report.status === 'healthy' ? 200 : 503);
  });
}
