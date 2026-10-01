import { describe, expect, it } from 'vitest';
import type { BookingDto } from '@driverzone/contracts';
import { formatMinutes, tripDistanceText, tripDurationText } from './format';

type DurationInput = Parameters<typeof tripDurationText>[0];

function trip(over: Partial<DurationInput> & { started?: string; completed?: string } = {}): DurationInput {
  const { started, completed, ...rest } = over;
  return {
    status: 'CONFIRMED',
    service_type: 'INCITY',
    included_minutes: 180,
    timestamps: {
      started_at: started ?? null,
      completed_at: completed ?? null,
    } as BookingDto['timestamps'],
    ...rest,
  };
}

describe('formatMinutes', () => {
  it('reads as hours and minutes', () => {
    expect(formatMinutes(200)).toBe('3h 20m');
    expect(formatMinutes(180)).toBe('3h');
    expect(formatMinutes(45)).toBe('45m');
  });
});

describe('tripDurationText — never a bare "not available"', () => {
  it('shows what was booked before the trip starts', () => {
    expect(tripDurationText(trip())).toBe('3h booked');
  });

  it('says outstation is a package, since it has no hours figure', () => {
    expect(tripDurationText(trip({ service_type: 'OUTSTATION', included_minutes: null }))).toBe(
      'Outstation package',
    );
  });

  it('shows how long a running trip has gone', () => {
    const now = new Date('2026-10-01T10:30:00Z');
    expect(
      tripDurationText(trip({ status: 'STARTED', started: '2026-10-01T09:00:00Z' }), now),
    ).toBe('Running 1h 30m');
  });

  it('shows what a finished trip actually took', () => {
    expect(
      tripDurationText(
        trip({
          status: 'COMPLETED',
          started: '2026-10-01T09:00:00Z',
          completed: '2026-10-01T12:08:00Z',
        }),
      ),
    ).toBe('3h 8m taken');
  });

  it('says a cancelled trip never started', () => {
    expect(tripDurationText(trip({ status: 'CANCELLED_BY_ADMIN' }))).toBe('Trip did not start');
  });
});

describe('tripDistanceText', () => {
  it('explains why an in-city trip has no distance', () => {
    expect(tripDistanceText({ distance_km: null, service_type: 'INCITY' })).toBe(
      'In-city — priced by time',
    );
    expect(tripDistanceText({ distance_km: 42.04, service_type: 'OUTSTATION' })).toBe('42.0 km');
  });
});
