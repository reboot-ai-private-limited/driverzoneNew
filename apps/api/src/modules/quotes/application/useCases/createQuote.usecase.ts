import type { Direction, UnavailableResult } from '@driverzone/contracts';
import type { LatLng } from '@driverzone/geo';
import type { SettingsReadContract } from '../../../settings/settings.public.js';
import { rupeesToPaise } from '../../../settings/settings.public.js';
import type { PackageLookupContract } from '../../../packages/packages.public.js';
import type { ZoneResolutionContract } from '../../../zones/zones.public.js';
import {
  computeIncityFare,
  computeOutstationFare,
  type FareConfig,
  type PickupZoneFare,
} from '../../../pricing/pricing.public.js';
import { QUOTE_TTL_MS, type Quote, type QuoteSource } from '../../domain/quote.entity.js';
import type { NewQuote, QuoteRepositoryPort } from '../../domain/quoteRepository.port.js';
import type { RoadDistancePort } from '../../domain/roadDistance.port.js';

export interface CreateQuoteInput {
  customerId: string;
  pickup: LatLng;
  drop: LatLng;
  /** Omitted means now. The SERVER decides, so a device with a wrong clock cannot book backwards. */
  scheduledAt?: Date | undefined;
  direction?: Direction | undefined;
}

export interface QuotedTrip {
  available: true;
  quotes: Quote[];
  distanceKm: number | null;
  outstationHoursPerDay: number | null;
}

export type CreateQuoteResult = QuotedTrip | UnavailableResult;

/**
 * Prices a trip.
 *
 * The orchestration this module exists for: resolve both points to zones, measure the road, ask
 * `packages` which single product applies, and run the arithmetic in `pricing`. Each of those is
 * somebody else's decision — this use case is deliberately the only place that knows the order.
 *
 * "WE CANNOT SERVE THIS" IS NOT AN ERROR. An unserved pickup point, no package for a distance, no
 * road between the points — all return a 200 with `available: false` and a customer-safe message,
 * so they stay out of the error dashboards and the app can render a helpful screen instead of a
 * generic failure.
 */
export class CreateQuoteUseCase {
  constructor(
    private readonly zones: ZoneResolutionContract,
    private readonly packages: PackageLookupContract,
    private readonly settings: SettingsReadContract,
    private readonly distance: RoadDistancePort,
    private readonly repo: QuoteRepositoryPort,
  ) {}

  async execute(input: CreateQuoteInput): Promise<CreateQuoteResult> {
    const now = new Date();
    const scheduledAt = input.scheduledAt ?? now;

    // ── 1. The pickup point has to be somewhere we serve ────────────────────────────────────
    const from = await this.zones.resolveAt(input.pickup);
    if (from.pickup === null) {
      return {
        available: false,
        reason: 'ZONE_NO_PICKUP_COVERAGE',
        message: 'We do not pick up from this location yet.',
      };
    }

    // ── 2. What the destination is ──────────────────────────────────────────────────────────
    const to = await this.zones.resolveAt(input.drop);
    const toSameCityZone = from.city !== null && to.city !== null && from.city.id === to.city.id;

    // ── 3. How far, by road ─────────────────────────────────────────────────────────────────
    const distanceKm = await this.distance.roadDistanceKm(input.pickup, input.drop);
    if (distanceKm === null) {
      return {
        available: false,
        reason: 'ROUTE_NOT_FOUND',
        message: 'We could not find a driving route between these two points.',
      };
    }

    // ── 4. Exactly one product, chosen by `packages` and never by us ────────────────────────
    const match = await this.packages.resolveForTrip({
      ...(from.city === null ? {} : { fromCityZoneId: from.city.id }),
      toSameCityZone,
      toHillZone: to.hill !== null,
      distanceKm,
      ...(input.direction === undefined ? {} : { direction: input.direction }),
    });

    if (!match.available) {
      return { available: false, reason: match.code, message: match.message };
    }

    // ── 5. The arithmetic ───────────────────────────────────────────────────────────────────
    const snapshot = await this.settings.snapshot();
    const config: FareConfig = {
      earlyMorningWindow: snapshot['pricing.early_morning_window'],
      earlyMorningChargePaise: rupeesToPaise(snapshot['pricing.early_morning_charge']),
      lateNightWindow: snapshot['pricing.late_night_window'],
      lateNightChargePaise: rupeesToPaise(snapshot['pricing.late_night_charge']),
      insuranceChargePaise: rupeesToPaise(snapshot['pricing.insurance_charge']),
      taxBps: snapshot['pricing.tax_bps'],
    };

    const pickupZone: PickupZoneFare = {
      name: from.pickup.name,
      chargeType: from.pickup.pickupChargeType ?? 'FREE',
      chargePaise: from.pickup.pickupChargePaise,
      defaultChargePaise: rupeesToPaise(snapshot['pickup.default_charge']),
    };

    const expiresAt = new Date(now.getTime() + QUOTE_TTL_MS);

    const baseSource = {
      pickupZoneId: from.pickup.id,
      pickupZoneName: from.pickup.name,
      cityZoneId: from.city?.id ?? null,
      cityName: from.city?.name ?? null,
    };

    const common = {
      customerId: input.customerId,
      pickup: { lat: input.pickup.lat, lng: input.pickup.lng },
      drop: { lat: input.drop.lat, lng: input.drop.lng },
      scheduledAt,
      expiresAt,
    };

    if (match.match.type === 'INCITY') {
      const { package: pkg, variants } = match.match;

      /*
       * ONE ROW PER VARIANT. The customer picks a duration from the fare card, so every duration
       * on offer needs its own quote id — the alternative, one quote plus a variant id at booking
       * time, would let the client choose a variant the price was not computed for.
       */
      const quotes = variants.map((variant): NewQuote => {
        const source: QuoteSource = {
          ...baseSource,
          packageId: pkg.id,
          packageName: pkg.name,
          variantId: variant.id,
          variantLabel: variant.label,
          terrain: null,
        };

        return {
          ...common,
          serviceType: 'INCITY',
          direction: null,
          distanceKm: null,
          includedMinutes: variant.includedMinutes,
          source,
          fare: computeIncityFare(
            {
              variantLabel: variant.label,
              baseFarePaise: variant.baseFarePaise,
              driverCommissionBps: variant.driverCommissionBps,
              pickupZone,
              scheduledAt,
            },
            config,
          ),
        };
      });

      return {
        available: true,
        quotes: await this.repo.createMany(quotes),
        distanceKm: null,
        outstationHoursPerDay: null,
      };
    }

    const { package: pkg, farePaise, direction } = match.match;
    const source: QuoteSource = {
      ...baseSource,
      packageId: pkg.id,
      packageName: pkg.name,
      variantId: null,
      variantLabel: null,
      terrain: pkg.terrain,
    };

    const quote: NewQuote = {
      ...common,
      serviceType: 'OUTSTATION',
      direction,
      distanceKm,
      includedMinutes: null,
      source,
      fare: computeOutstationFare(
        {
          packageName: pkg.name,
          terrain: pkg.terrain,
          direction,
          farePaise,
          driverCommissionBps: pkg.driverCommissionBps,
          pickupZone,
          scheduledAt,
        },
        config,
      ),
    };

    return {
      available: true,
      quotes: await this.repo.createMany([quote]),
      distanceKm,
      // Display-only policy text. Carried on the response so the fare card can state it; nothing
      // in the arithmetic above reads it.
      outstationHoursPerDay: snapshot['outstation.hours_per_day'],
    };
  }
}
