import type {
  CreateIncityPackageRequest,
  CreateOutstationPackageRequest,
  IncityPackageDto,
  IncityVariantInput,
  OutstationPackageDto,
  Terrain,
} from '@driverzone/contracts';
import { validateBand } from './band';
import { bpsToPercent, paiseToRupees, percentToBps, rupeesToPaise } from './money';

/**
 * The editors' form model, and the conversion to and from the wire.
 *
 * EVERY FIELD IS A STRING, including the numbers — the same rule the settings screen's
 * `draft.ts` states and for the same reason: a text input holds a string, and it is the only
 * representation in which "the admin has cleared this box" stays distinguishable from zero. A
 * base fare of `0` is a free trip; a base fare of `''` is a field nobody has filled in. Storing
 * both as `number | undefined` loses that the moment someone writes `?? 0`.
 *
 * Kept here rather than in a component so it can be tested in `node`.
 */

export type FieldErrors = Record<string, string>;
export type BuildResult<T> = { ok: true; body: T } | { ok: false; errors: FieldErrors };

// ─── Outstation ──────────────────────────────────────────────────────────────────────────────

export interface OutstationDraft {
  name: string;
  terrain: Terrain;
  minKm: string;
  maxKm: string;
  oneWayFare: string;
  /**
   * The whole two-way journey, not capped to same-day.
   *
   * Empty means the band does not sell a return trip — it maps to `null` on the wire, never to
   * `0`. This is exactly the distinction the string draft exists to preserve: `'0'` is a free
   * return trip, `''` is no return trip on offer.
   */
  roundTripFare: string;
  driverCommission: string;
  isActive: boolean;
}

export interface OutstationPrefill {
  terrain?: Terrain | undefined;
  minKm?: string | undefined;
  maxKm?: string | undefined;
}

/**
 * A blank band, optionally pre-filled from the gap the admin clicked in the coverage table.
 *
 * The pre-fill is the point of the gap row being actionable at all: closing a gap should be one
 * click and two fares, not a form where the admin reads the range off the screen and retypes it
 * — which is where an off-by-one that reopens the gap comes from.
 */
export function emptyOutstationDraft(prefill: OutstationPrefill = {}): OutstationDraft {
  return {
    name: '',
    terrain: prefill.terrain ?? 'PLAIN',
    minKm: prefill.minKm ?? '',
    maxKm: prefill.maxKm ?? '',
    oneWayFare: '',
    roundTripFare: '',
    driverCommission: '',
    isActive: true,
  };
}

export function toOutstationDraft(dto: OutstationPackageDto): OutstationDraft {
  return {
    name: dto.name,
    terrain: dto.terrain,
    minKm: String(dto.min_km),
    maxKm: String(dto.max_km),
    oneWayFare: paiseToRupees(dto.one_way_fare_paise),
    roundTripFare:
      dto.round_trip_fare_paise === null ? '' : paiseToRupees(dto.round_trip_fare_paise),
    driverCommission: bpsToPercent(dto.driver_commission_bps),
    isActive: dto.is_active,
  };
}

/**
 * Copy a band's fares onto a new draft covering `[splitKm, maxKm)`.
 *
 * Fares are COPIED, not divided. Dividing by distance would invent the per-km rate this model
 * deliberately deleted, and it would be a number nobody chose.
 */
export function splitDraftFrom(
  dto: OutstationPackageDto,
  splitKm: number,
  name: string,
): OutstationDraft {
  return {
    ...toOutstationDraft(dto),
    name,
    minKm: String(splitKm),
    maxKm: String(dto.max_km),
  };
}

export function buildOutstationBody(
  draft: OutstationDraft,
): BuildResult<CreateOutstationPackageRequest> {
  const errors: FieldErrors = {};

  if (draft.name.trim() === '') errors['name'] = 'Give the band a name.';

  const minKm = wholeNumber(draft.minKm);
  const maxKm = wholeNumber(draft.maxKm);
  if (minKm === null) errors['minKm'] = 'Enter a whole number of km.';
  if (maxKm === null) errors['maxKm'] = 'Enter a whole number of km.';
  if (minKm !== null && maxKm !== null) {
    const bandError = validateBand(minKm, maxKm);
    // On `maxKm`, because that is the field the admin fixes — `0–0` is corrected by raising the
    // upper bound far more often than by lowering the lower one.
    if (bandError !== null) errors['maxKm'] = bandError;
  }

  const oneWayFarePaise = rupeesToPaise(draft.oneWayFare);
  if (oneWayFarePaise === null) errors['oneWayFare'] = 'Enter the one-way fare in rupees.';

  // Empty is legal and means "not offered". Anything else must parse.
  const roundTripBlank = draft.roundTripFare.trim() === '';
  const roundTripFarePaise = roundTripBlank ? null : rupeesToPaise(draft.roundTripFare);
  if (!roundTripBlank && roundTripFarePaise === null) {
    errors['roundTripFare'] = 'Enter an amount in rupees, or leave it blank for no return trip.';
  }

  const driverCommissionBps = percentToBps(draft.driverCommission);
  if (driverCommissionBps === null) {
    errors['driverCommission'] = 'Enter the driver’s share as a percentage between 0 and 100.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    body: {
      name: draft.name.trim(),
      terrain: draft.terrain,
      minKm: minKm as number,
      maxKm: maxKm as number,
      oneWayFarePaise: oneWayFarePaise as number,
      roundTripFarePaise,
      driverCommissionBps: driverCommissionBps as number,
      isActive: draft.isActive,
    },
  };
}

// ─── InCity ──────────────────────────────────────────────────────────────────────────────────

/**
 * A duration and a price. The included-km cap, both overage rates, the destination-enforcement
 * flag and the sort order were removed 2026-08-28 (docs/decision-log.md) — there is no overage
 * to bill, and variants display in the order the editor lists them.
 */
export interface VariantDraft {
  /** Stable across re-renders and reorders. Not the server's subdocument id — see below. */
  key: string;
  label: string;
  includedMinutes: string;
  baseFare: string;
  driverCommission: string;
  isActive: boolean;
}

export interface IncityDraft {
  name: string;
  description: string;
  cityZoneId: string;
  isActive: boolean;
  variants: VariantDraft[];
}

let variantKeySeq = 0;
/**
 * A local key, deliberately not the server's `id`.
 *
 * `PUT` replaces the whole `variants` array, so every save mints fresh subdocument ids — a React
 * key taken from the server's id would change under a row the admin is still typing in. A local
 * counter is stable for the life of the form, which is exactly the lifetime a key needs.
 */
export function newVariantKey(): string {
  variantKeySeq += 1;
  return `variant-${variantKeySeq}`;
}

export function emptyVariantDraft(): VariantDraft {
  return {
    key: newVariantKey(),
    label: '',
    includedMinutes: '',
    baseFare: '',
    driverCommission: '',
    isActive: true,
  };
}

export function emptyIncityDraft(cityZoneId = ''): IncityDraft {
  return {
    name: '',
    description: '',
    cityZoneId,
    isActive: true,
    variants: [emptyVariantDraft()],
  };
}

export function toIncityDraft(dto: IncityPackageDto): IncityDraft {
  return {
    name: dto.name,
    description: dto.description ?? '',
    cityZoneId: dto.city_zone_id,
    isActive: dto.is_active,
    variants: dto.variants.map((variant) => ({
      key: newVariantKey(),
      label: variant.label,
      includedMinutes: String(variant.included_minutes),
      baseFare: paiseToRupees(variant.base_fare_paise),
      driverCommission: bpsToPercent(variant.driver_commission_bps),
      isActive: variant.is_active,
    })),
  };
}

export function buildIncityBody(draft: IncityDraft): BuildResult<CreateIncityPackageRequest> {
  const errors: FieldErrors = {};

  if (draft.name.trim() === '') errors['name'] = 'Give the package a name.';
  if (draft.cityZoneId === '') errors['cityZoneId'] = 'Pick the city zone this sells against.';
  if (draft.variants.length === 0) errors['variants'] = 'A package needs at least one variant.';

  const variants: IncityVariantInput[] = draft.variants.map((variant) => {
    const scope = `variants.${variant.key}`;
    if (variant.label.trim() === '') errors[`${scope}.label`] = 'Name the variant.';

    const includedMinutes = wholeNumber(variant.includedMinutes);
    if (includedMinutes === null || includedMinutes < 1) {
      errors[`${scope}.includedMinutes`] = 'Enter the included minutes.';
    }

    const baseFarePaise = rupeesToPaise(variant.baseFare);
    if (baseFarePaise === null) errors[`${scope}.baseFare`] = 'Enter the base fare in rupees.';

    const driverCommissionBps = percentToBps(variant.driverCommission);
    if (driverCommissionBps === null) {
      errors[`${scope}.driverCommission`] =
        'Enter the driver’s share as a percentage between 0 and 100.';
    }

    return {
      label: variant.label.trim(),
      includedMinutes: includedMinutes ?? 0,
      baseFarePaise: baseFarePaise ?? 0,
      driverCommissionBps: driverCommissionBps ?? 0,
      isActive: variant.isActive,
    };
  });

  // P-3, checked where the admin can act on it. It narrowed when per-category pricing went: a
  // variant now carries its fare, so one ACTIVE variant is the whole invariant. The server
  // answers 422 PACKAGE_NOT_SELLABLE regardless; this saves the round trip.
  if (draft.isActive && !variants.some((variant) => variant.isActive !== false)) {
    errors['variants'] = 'An active package needs at least one active variant.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const description = draft.description.trim();
  return {
    ok: true,
    body: {
      cityZoneId: draft.cityZoneId,
      name: draft.name.trim(),
      // `exactOptionalPropertyTypes`: omit it rather than sending an explicit undefined.
      ...(description === '' ? {} : { description }),
      variants,
      isActive: draft.isActive,
    },
  };
}

// ─── Shared parsing ──────────────────────────────────────────────────────────────────────────

function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}
