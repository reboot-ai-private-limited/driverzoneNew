import type { Router } from 'express';
import { env, isProduction } from '../../config/env.js';
import type { PackageLookupContract } from '../packages/packages.public.js';
import type { SettingsReadContract } from '../settings/settings.public.js';
import type { ZoneResolutionContract } from '../zones/zones.public.js';
import type { ConsumeResult, QuotesPublicContract } from './quotes.public.js';
import { isExpired } from './domain/quote.entity.js';
import type { RoadDistancePort } from './domain/roadDistance.port.js';
import { MongoQuoteRepository } from './infrastructure/quoteRepository.impl.js';
import { CachingRoadDistance } from './infrastructure/caching.roadDistance.js';
import { GoogleRoadDistance } from './infrastructure/google.roadDistance.js';
import { OsrmRoadDistance } from './infrastructure/osrm.roadDistance.js';
import { HaversineRoadDistance } from './infrastructure/haversine.roadDistance.js';
import { CreateQuoteUseCase } from './application/useCases/createQuote.usecase.js';
import { ExplainTripUseCase } from './application/useCases/explainTrip.usecase.js';
import {
  makeCreateQuoteController,
  makeExplainTripController,
} from './interface/quotes.controller.js';
import { buildAdminRouter, buildCustomerRouter } from './interface/quotes.routes.js';

export interface QuotesContainer {
  contract: QuotesPublicContract;
  buildCustomerRouter: () => Router;
  buildAdminRouter: () => Router;
}

export interface QuotesDependencies {
  zones: ZoneResolutionContract;
  packages: PackageLookupContract;
  settings: SettingsReadContract;
}

/**
 * Chooses the road-distance adapter, then wraps it in the shared read-through cache.
 *
 * Precedence:
 *   1. `GOOGLE_ROUTES_API_KEY` set → Google Routes API. The deployed path since the pilot VM
 *      could not host an OSRM India extract (docs/decision-log.md).
 *   2. else, production or a non-default `OSRM_BASE_URL` → OSRM, for anyone still self-hosting.
 *   3. else → the haversine stand-in, which refuses to construct in production anyway.
 *
 * The cache wraps whichever is chosen — it is provider-neutral, and its only effect is to make
 * quoting cheaper.
 */
function selectRoadDistance(): RoadDistancePort {
  const base: RoadDistancePort = env.GOOGLE_ROUTES_API_KEY
    ? new GoogleRoadDistance(env.GOOGLE_ROUTES_API_KEY)
    : isProduction || env.OSRM_BASE_URL !== 'http://localhost:5000'
      ? new OsrmRoadDistance()
      : new HaversineRoadDistance();

  return new CachingRoadDistance(base);
}

export function buildQuotesContainer(deps: QuotesDependencies): QuotesContainer {
  const repo = new MongoQuoteRepository();
  /*
   * ONE ADAPTER SHARED BY BOTH, deliberately: it is the caching one, so the admin diagnostic
   * looking at a trip a customer just quoted answers from that same cached measurement rather
   * than paying the provider for a second copy of it.
   */
  const roadDistance = selectRoadDistance();
  const create = new CreateQuoteUseCase(
    deps.zones,
    deps.packages,
    deps.settings,
    roadDistance,
    repo,
  );
  const explain = new ExplainTripUseCase(deps.zones, deps.packages, roadDistance);

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
    buildAdminRouter: () => buildAdminRouter({ explainTrip: makeExplainTripController(explain) }),
  };
}
