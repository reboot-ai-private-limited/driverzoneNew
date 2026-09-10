import { describe, expect, it } from 'vitest';
import type { IncityPackageDto, OutstationPackageDto } from '@driverzone/contracts';
import {
  buildIncityBody,
  buildOutstationBody,
  emptyIncityDraft,
  emptyOutstationDraft,
  splitDraftFrom,
  toIncityDraft,
  toOutstationDraft,
  type OutstationDraft,
} from './draft';

function sellableBand(over: Partial<OutstationDraft> = {}): OutstationDraft {
  return {
    ...emptyOutstationDraft(),
    name: 'PKG-1',
    minKm: '70',
    maxKm: '100',
    oneWayFare: '2100',
    roundTripFare: '3700',
    driverAmount: '1500',
    ...over,
  };
}

describe('buildOutstationBody', () => {
  it('converts every rupee field to paise', () => {
    const result = buildOutstationBody(sellableBand());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toEqual({
      name: 'PKG-1',
      terrain: 'PLAIN',
      minKm: 70,
      maxKm: 100,
      oneWayFarePaise: 210000,
      roundTripFarePaise: 370000,
      driverAmountPaise: 150000,
      isActive: true,
    });
  });

  /**
   * The distinction the string draft exists to preserve, and the reason the wire field is
   * nullable rather than defaulted to zero.
   */
  it('sends a BLANK return fare as null — the band does not sell a return trip', () => {
    const result = buildOutstationBody(sellableBand({ roundTripFare: '' }));

    expect(result.ok && result.body.roundTripFarePaise).toBeNull();
  });

  it('sends a return fare of ZERO as 0 — a free return trip is not the same thing', () => {
    // driverAmount 0 too: a ₹0 return fare cannot pay out anything, and the amount-vs-fare
    // check would otherwise reject the fixture's default ₹1500.
    const result = buildOutstationBody(sellableBand({ roundTripFare: '0', driverAmount: '0' }));

    expect(result.ok && result.body.roundTripFarePaise).toBe(0);
  });

  it('refuses a zero-width band, on the field the admin fixes', () => {
    const result = buildOutstationBody(sellableBand({ minKm: '100', maxKm: '100' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors['maxKm']).toMatch(/greater than/);
  });

  it('requires the one-way fare — a band with no fare cannot be sold', () => {
    const result = buildOutstationBody(sellableBand({ oneWayFare: '' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors['oneWayFare']).toMatch(/one-way fare/);
  });

  it('refuses a driver amount above the fare', () => {
    // Over the one-way fare of ₹2100, though it would fit inside the return fare.
    const result = buildOutstationBody(sellableBand({ driverAmount: '2500' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors['driverAmount']).toMatch(/more than the fare/);
  });

  it('allows a driver amount equal to the fare', () => {
    const result = buildOutstationBody(sellableBand({ oneWayFare: '2100', driverAmount: '2100' }));
    expect(result.ok).toBe(true);
  });

  it('collects every bad field at once rather than one per save', () => {
    const result = buildOutstationBody(
      sellableBand({ name: '', minKm: 'abc', oneWayFare: '', driverAmount: '' }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      'driverAmount',
      'minKm',
      'name',
      'oneWayFare',
    ]);
  });

  it('round-trips a DTO through the draft unchanged', () => {
    const dto: OutstationPackageDto = {
      id: 'p1',
      name: 'Hills long',
      terrain: 'HILL',
      min_km: 70,
      max_km: 100,
      one_way_fare_paise: 240000,
      round_trip_fare_paise: null,
      driver_amount_paise: 170000,
      is_active: true,
    };

    const result = buildOutstationBody(toOutstationDraft(dto));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toEqual({
      name: 'Hills long',
      terrain: 'HILL',
      minKm: 70,
      maxKm: 100,
      oneWayFarePaise: 240000,
      roundTripFarePaise: null,
      driverAmountPaise: 170000,
      isActive: true,
    });
  });
});

describe('splitDraftFrom', () => {
  const dto: OutstationPackageDto = {
    id: 'p1',
    name: 'Plains long',
    terrain: 'PLAIN',
    min_km: 0,
    max_km: 150,
    one_way_fare_paise: 180000,
    round_trip_fare_paise: 320000,
    driver_amount_paise: 120000,
    is_active: true,
  };

  it('carries the upper half of the range and COPIES the fares', () => {
    const draft = splitDraftFrom(dto, 70, 'Plains long (70+)');

    expect(draft.minKm).toBe('70');
    expect(draft.maxKm).toBe('150');
    // Copied, not divided. Dividing by distance would invent the per-km rate this model deleted.
    expect(draft.oneWayFare).toBe('1800');
    expect(draft.roundTripFare).toBe('3200');
    expect(draft.terrain).toBe('PLAIN');
  });

  it('produces a body the API would accept', () => {
    const result = buildOutstationBody(splitDraftFrom(dto, 70, 'Plains long (70+)'));

    expect(result.ok && result.body).toMatchObject({ minKm: 70, maxKm: 150 });
  });

  it('keeps a band that sells no return trip selling none', () => {
    const draft = splitDraftFrom({ ...dto, round_trip_fare_paise: null }, 70, 'x');

    expect(draft.roundTripFare).toBe('');
    const result = buildOutstationBody(draft);
    expect(result.ok && result.body.roundTripFarePaise).toBeNull();
  });
});

describe('buildIncityBody', () => {
  function sellablePackage() {
    const draft = emptyIncityDraft('zone-1');
    draft.name = 'Siliguri Hourly';
    const variant = draft.variants[0]!;
    variant.label = '3 Hours';
    variant.includedMinutes = '180';
    variant.baseFare = '900';
    variant.driverAmount = '675';
    return draft;
  }

  it('builds the variant array with fares on the variant itself', () => {
    const result = buildIncityBody(sellablePackage());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.cityZoneId).toBe('zone-1');
    expect(result.body.variants[0]).toEqual({
      label: '3 Hours',
      includedMinutes: 180,
      baseFarePaise: 90000,
      driverAmountPaise: 67500,
      isActive: true,
    });
  });

  it('requires the included time — it is what the customer buys', () => {
    const draft = sellablePackage();
    draft.variants[0]!.includedMinutes = '';

    const result = buildIncityBody(draft);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[`variants.${draft.variants[0]!.key}.includedMinutes`]).toBeDefined();
  });

  it('omits an empty description rather than sending undefined', () => {
    const result = buildIncityBody(sellablePackage());

    expect(result.ok && 'description' in result.body).toBe(false);
  });

  it('requires a city zone — the only zone reference either product carries', () => {
    const draft = sellablePackage();
    draft.cityZoneId = '';

    const result = buildIncityBody(draft);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors['cityZoneId']).toBeDefined();
  });

  /** P-3, narrowed: one ACTIVE variant is now the whole invariant. */
  it('refuses an active package whose only variant is switched off', () => {
    const draft = sellablePackage();
    draft.variants[0]!.isActive = false;

    const result = buildIncityBody(draft);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors['variants']).toMatch(/active variant/);
  });

  it('allows an INACTIVE package whose variants are all off — it cannot be sold anyway', () => {
    const draft = sellablePackage();
    draft.isActive = false;
    draft.variants[0]!.isActive = false;

    expect(buildIncityBody(draft).ok).toBe(true);
  });

  it('scopes a fare error to its variant, so two variants do not share one message', () => {
    const draft = sellablePackage();
    draft.variants[0]!.baseFare = 'free';

    const result = buildIncityBody(draft);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[`variants.${draft.variants[0]!.key}.baseFare`]).toMatch(/base fare/);
  });

  it('refuses a variant driver amount above its own fare', () => {
    const draft = sellablePackage();
    draft.variants[0]!.baseFare = '900';
    draft.variants[0]!.driverAmount = '1200';

    const result = buildIncityBody(draft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[`variants.${draft.variants[0]!.key}.driverAmount`]).toMatch(
      /more than the fare/,
    );
  });

  it('round-trips a DTO through the draft unchanged', () => {
    const dto: IncityPackageDto = {
      id: 'p1',
      city_zone_id: 'zone-1',
      name: 'Siliguri Hourly',
      description: 'Hourly rentals',
      is_active: true,
      variants: [
        {
          id: 'v1',
          label: '10 Hours',
          included_minutes: 600,
          base_fare_paise: 220000,
          driver_amount_paise: 165000,
          is_active: true,
        },
      ],
    };

    const result = buildIncityBody(toIncityDraft(dto));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      cityZoneId: 'zone-1',
      name: 'Siliguri Hourly',
      description: 'Hourly rentals',
    });
    expect(result.body.variants[0]).toEqual({
      label: '10 Hours',
      includedMinutes: 600,
      baseFarePaise: 220000,
      driverAmountPaise: 165000,
      isActive: true,
    });
  });
});
