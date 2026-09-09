import { describe, expect, it } from 'vitest';
import {
  formatArea,
  formatDate,
  formatDistance,
  formatMobile,
  formatPaise,
  formatTime,
  istDateKey,
} from './format';

describe('timestamps render in Asia/Kolkata, not the browser zone', () => {
  // 18:45 UTC is 00:15 the NEXT DAY in IST. A formatter that quietly used the local zone
  // would pass in India and be a day out for anyone running the panel from elsewhere —
  // which is exactly the bug that never gets noticed until it matters.
  const lateUtc = '2026-05-18T18:45:00Z';

  it('rolls the date over correctly', () => {
    expect(formatDate(lateUtc)).toBe('19 May 2026');
  });

  it('renders the IST wall clock', () => {
    expect(formatTime(lateUtc)).toMatch(/12:15\s*am/i);
  });
});

describe('istDateKey names the IST day, not the UTC one', () => {
  // The dashboard's "today" filters are built from this, so the failure it guards against is a
  // bookings tile that reads zero every night between IST midnight and 05:30 and then jumps —
  // which looks like the API is down rather than like a timezone bug.
  it('rolls over at IST midnight, not UTC midnight', () => {
    // 18:45 UTC on the 18th is already 00:15 on the 19th in IST.
    expect(istDateKey(new Date('2026-05-18T18:45:00Z'))).toBe('2026-05-19');
  });

  it('still names the earlier day just before that boundary', () => {
    // 18:15 UTC is 23:45 IST — the same calendar day, and the case a naive UTC slice gets right
    // by accident. Both directions are asserted so the fix cannot be "always add a day".
    expect(istDateKey(new Date('2026-05-18T18:15:00Z'))).toBe('2026-05-18');
  });

  it('formats as YYYY-MM-DD, which is what the API filters take', () => {
    expect(istDateKey(new Date('2026-01-05T06:00:00Z'))).toBe('2026-01-05');
  });
});

describe('distance is metres in, readable out', () => {
  it.each([
    [0, '0 m'],
    [850, '850 m'],
    [999, '999 m'],
    [1000, '1.0 km'],
    [8400, '8.4 km'],
  ])('%i m → %s', (metres, expected) => {
    expect(formatDistance(metres)).toBe(expected);
  });
});

describe('area', () => {
  it('renders square metres as km²', () => {
    expect(formatArea(12_400_000)).toBe('12.4 km²');
  });
});

describe('money is integer paise', () => {
  it('drops the decimals on a whole number of rupees', () => {
    expect(formatPaise(105000)).toBe('₹1,050');
  });

  it('keeps them when the amount is not whole', () => {
    expect(formatPaise(149950)).toContain('1,499.50');
  });

  it('groups in the Indian system, not thousands', () => {
    // 1,48,920 — not 148,920. en-IN is doing real work here.
    expect(formatPaise(14_892_000)).toContain('1,48,920');
  });
});

describe('mobile numbers', () => {
  it('spaces an Indian E.164 number for reading', () => {
    expect(formatMobile('+919876543210')).toBe('+91 98765 43210');
  });

  it('leaves anything else exactly as the API sent it', () => {
    expect(formatMobile('+14155550123')).toBe('+14155550123');
  });
});
