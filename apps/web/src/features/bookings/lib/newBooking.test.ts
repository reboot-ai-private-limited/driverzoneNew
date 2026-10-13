import { describe, expect, it } from 'vitest';
import {
  buildCreateBookingRequest,
  buildQuoteRequest,
  istLocalToIso,
  placeLabel,
  pointLabelFromGeocode,
  quoteBlocker,
  toIndianE164,
  type TripDraft,
} from './newBooking';

const pickup = { lat: 26.7271, lng: 88.3953, address: 'Hakimpara, Siliguri' };
const drop = { lat: 26.73, lng: 88.4, address: 'Sevoke Road, Siliguri' };

const draft: TripDraft = {
  pickup,
  drop,
  when: 'NOW',
  scheduledLocal: '',
  direction: 'ONE_WAY',
  returnLocal: '',
  insurance: true,
};

describe('placeLabel — the searched place keeps its own name', () => {
  it('puts the place name in front of its address', () => {
    expect(placeLabel('Hakimpara', 'Haren Mukherjee Rd, Siliguri, West Bengal')).toBe(
      'Hakimpara, Haren Mukherjee Rd, Siliguri, West Bengal',
    );
  });

  it('does not repeat a name the address already starts with', () => {
    expect(placeLabel('Sevoke Road', 'Sevoke Road, Siliguri')).toBe('Sevoke Road, Siliguri');
  });

  it('falls back to whichever half exists', () => {
    expect(placeLabel(null, 'Siliguri')).toBe('Siliguri');
    expect(placeLabel('Hakimpara', null)).toBe('Hakimpara');
  });
});

describe('pointLabelFromGeocode — labelling a clicked or dragged pin', () => {
  it('skips the Plus Code Google puts first and takes the real address', () => {
    expect(
      pointLabelFromGeocode([
        { formatted_address: 'PC8G+2C9, Siliguri, West Bengal', types: ['plus_code'] },
        { formatted_address: 'Haren Mukherjee Rd, Hakim Para, Siliguri', types: ['route'] },
      ]),
    ).toBe('Haren Mukherjee Rd, Hakim Para, Siliguri');
  });

  it('is null when there is nothing better than the coordinate', () => {
    expect(pointLabelFromGeocode([])).toBeNull();
    expect(pointLabelFromGeocode([{ formatted_address: 'PC8G+2C9', types: ['plus_code'] }])).toBeNull();
  });
});

describe('istLocalToIso — a typed time is IST whatever the laptop thinks', () => {
  it('reads 09:00 as 09:00 in India', () => {
    expect(istLocalToIso('2026-10-05T09:00')).toBe('2026-10-05T03:30:00.000Z');
  });

  it('refuses anything that is not a datetime-local value', () => {
    expect(istLocalToIso('')).toBeNull();
    expect(istLocalToIso('tomorrow')).toBeNull();
  });
});

describe('quoteBlocker', () => {
  const now = new Date('2026-10-01T06:00:00Z');

  it('asks for the pickup and the drop first', () => {
    expect(quoteBlocker({ ...draft, pickup: null }, now)).toMatch(/pickup/);
    expect(quoteBlocker({ ...draft, drop: null }, now)).toMatch(/destination/);
  });

  it('refuses a scheduled pickup in the past', () => {
    expect(quoteBlocker({ ...draft, when: 'LATER', scheduledLocal: '2026-10-01T09:00' }, now)).toMatch(
      /future/,
    );
  });

  it('refuses a return before the pickup', () => {
    expect(
      quoteBlocker(
        {
          ...draft,
          when: 'LATER',
          scheduledLocal: '2026-10-05T09:00',
          direction: 'ROUND_TRIP',
          returnLocal: '2026-10-04T09:00',
        },
        now,
      ),
    ).toMatch(/after the pickup/);
  });

  it('is satisfied by a complete trip', () => {
    expect(quoteBlocker(draft, now)).toBeNull();
  });
});

describe('buildQuoteRequest', () => {
  it('binds the quote to the customer and sends no time for "now"', () => {
    expect(buildQuoteRequest('cus_1', draft)).toEqual({
      customer_id: 'cus_1',
      pickup: { lat: pickup.lat, lng: pickup.lng },
      drop: { lat: drop.lat, lng: drop.lng },
      direction: 'ONE_WAY',
      insurance: true,
    });
  });

  it('sends the scheduled time and the return for a round trip', () => {
    const body = buildQuoteRequest('cus_1', {
      ...draft,
      when: 'LATER',
      scheduledLocal: '2026-10-05T09:00',
      direction: 'ROUND_TRIP',
      returnLocal: '2026-10-06T18:00',
    });
    expect(body.scheduledAt).toBe('2026-10-05T03:30:00.000Z');
    expect(body.returnAt).toBe('2026-10-06T12:30:00.000Z');
  });
});

describe('buildCreateBookingRequest', () => {
  it('carries the addresses the admin chose, trimmed', () => {
    expect(
      buildCreateBookingRequest({
        customerId: 'cus_1',
        quoteId: 'qot_1',
        pickup: { ...pickup, address: '  Hakimpara, Siliguri ' },
        drop,
        carCategory: 'SEDAN',
        vehicleType: 'MANUAL',
        paymentMode: 'CASH',
        paymentReference: '',
      }),
    ).toEqual({
      customer_id: 'cus_1',
      quote_id: 'qot_1',
      pickup_address: 'Hakimpara, Siliguri',
      drop_address: 'Sevoke Road, Siliguri',
      car_category: 'SEDAN',
      vehicle_type: 'MANUAL',
      payment_mode: 'CASH',
    });
  });

  const base = {
    customerId: 'cus_1',
    quoteId: 'qot_1',
    pickup,
    drop,
    carCategory: 'SEDAN' as const,
    vehicleType: 'MANUAL' as const,
  };

  it('sends a prepaid booking with its reference, trimmed', () => {
    const request = buildCreateBookingRequest({
      ...base,
      paymentMode: 'PREPAID',
      paymentReference: '  UTR 4455 ',
    });
    expect(request).toMatchObject({ payment_mode: 'PREPAID', payment_reference: 'UTR 4455' });
  });

  it('drops a reference typed against a cash booking', () => {
    const request = buildCreateBookingRequest({
      ...base,
      paymentMode: 'CASH',
      paymentReference: 'UTR 4455',
    });
    expect(request).not.toHaveProperty('payment_reference');
  });
});

describe('toIndianE164', () => {
  it('accepts the ways an admin actually types a number', () => {
    expect(toIndianE164('98765 43210')).toBe('+919876543210');
    expect(toIndianE164('09876543210')).toBe('+919876543210');
    expect(toIndianE164('+91 98765-43210')).toBe('+919876543210');
  });

  it('refuses what is not a ten-digit Indian mobile', () => {
    expect(toIndianE164('12345')).toBeNull();
    expect(toIndianE164('1234567890')).toBeNull();
  });
});
