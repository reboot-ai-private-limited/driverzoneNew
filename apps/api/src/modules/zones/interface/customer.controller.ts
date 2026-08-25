import type { RequestHandler } from 'express';
import type { CoverageCheckResponse } from '@driverzone/contracts';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { CheckCoverageUseCase } from '../application/useCases/checkCoverage.usecase.js';
import { zoneToDto } from './zoneDto.mapper.js';
import { coverageCheckQuerySchema } from './zones.validation.js';

export interface CustomerControllerDeps {
  checkCoverage: CheckCoverageUseCase;
}

export interface CustomerControllers {
  checkCoverage: RequestHandler;
}

/**
 * INTERFACE — the pre-flight coverage check. Unauthenticated on purpose: it runs before a
 * customer has typed a destination, per FR-B (docs/prd.md) and the home-screen "we serve your
 * area" affordance in `docs/LLD/api-contracts.md`.
 */
export function makeCustomerControllers(deps: CustomerControllerDeps): CustomerControllers {
  return {
    checkCoverage: asyncHandler(async (req, res) => {
      const q = coverageCheckQuerySchema.parse(req.query);
      const result = await deps.checkCoverage.execute({ lat: q.lat, lng: q.lng });
      const body: CoverageCheckResponse = {
        covered: result.covered,
        city: result.city === null ? null : zoneToDto(result.city),
        pickup: result.pickup === null ? null : zoneToDto(result.pickup),
      };
      sendSuccess(req, res, body, 'Coverage');
    }),
  };
}
