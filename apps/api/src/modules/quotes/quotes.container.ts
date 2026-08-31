import type { Router } from 'express';
import { env, isProduction } from '../../config/env.js';
import type { PackageLookupContract } from '../packages/packages.public.js';
import type { SettingsReadContract } from '../settings/settings.public.js';
import type { ZoneResolutionContract } from '../zones/zones.public.js';
import type { ConsumeResult, QuotesPublicContract } from './quotes.public.js';
import { isExpired } from './domain/quote.entity.js';
import type { RoadDistancePort } from './domain/roadDistance.port.js';
import { MongoQuoteRepository } from './infrastructure/quoteRepository.impl.js';
import { OsrmRoadDistance } from './infrastructure/osrm.roadDistance.js';
import { HaversineRoadDistance } from './infrastructure/haversine.roadDistance.js';
import { CreateQuoteUseCase } from './application/useCases/createQuote.usecase.js';
import { makeCreateQuoteController } from './interface/quotes.controller.js';
import { buildCustomerRouter } from './interface/quotes.routes.js';

export interface QuotesContainer {
  contract: QuotesPublicContract;
  buildCustomerRouter: () => Router;
}

export interface QuotesDependencies {
  zones: ZoneResolutionContract;
  packages: PackageLookupContract;
  settings: SettingsReadContract;
}

/**
 * Chooses the road-distance adapter.
 *
 * OSRM in production, always — the haversine adapter refuses to construct there anyway. Locally
 * it depends on whether OSRM is actually running, which it usually is not: the service is
 * commented out in `docker-compose.dev.yml` and needs a region extract. `USE_REAL_ROUTING` is the
 * opt-in for someone who has set it up.
 */
function selectRoadDistance(): RoadDistancePort {
  if (isProduction || env.OSRM_BASE_URL !== 'http://localhost:5000') {
    return new OsrmRoadDistance();
  }
  return new HaversineRoadDistance();
}

export function buildQuotesContainer(deps: QuotesDependencies): QuotesContainer {
  const repo = new MongoQuoteRepository();
  const create = new CreateQuoteUseCase(
    deps.zones,
    deps.packages,
    deps.settings,
    selectRoadDistance(),
    repo,
  );

  return {
    contract: {
      findById: (quoteId) => repo.findById(quoteId),

      /**
       * The atomic claim, plus a diagnosis when it fails.
       *
       * The compare-and-swap alone cannot say WHY it lost — an expired quote and an
       * already-booked one both return null — so a failed claim reads the row back to find out.
       * That read is not a race: both of those are terminal states, so whatever it finds is still
       * true when it reports it.
       */
      consume: async (quoteId, bookingId): Promise<ConsumeResult> => {
        const now = new Date();
        const claimed = await repo.consume(quoteId, bookingId, now);
        if (claimed !== null) return { claimed: true, quote: claimed };

        const existing = await repo.findById(quoteId);
        if (existing === null) return { claimed: false, reason: 'NOT_FOUND' };
        if (existing.consumedBy !== null) {
          return { claimed: false, reason: 'ALREADY_CONSUMED', bookingId: existing.consumedBy };
        }
        if (isExpired(existing, now)) return { claimed: false, reason: 'EXPIRED' };

        // Unclaimed, unexpired, and the swap still failed. Only reachable if the row changed
        // between the two calls, which means someone else claimed it in that window.
        return { claimed: false, reason: 'ALREADY_CONSUMED', bookingId: 'unknown' };
      },
    },
    buildCustomerRouter: () => buildCustomerRouter({ createQuote: makeCreateQuoteController(create) }),
  };
}
