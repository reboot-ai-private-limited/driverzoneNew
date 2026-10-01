import { describe, expect, it } from 'vitest';
import type { BookingDto } from '@driverzone/contracts';
import {
  buildAssignPayload,
  canTransfer,
  isTransferSubmitDisabled,
  transferDialogCopy,
} from './transfer';

const ALL_STATUSES: BookingDto['status'][] = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'SEARCHING',
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'COMPLETED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN',
  'NO_DRIVER_FOUND',
  'EXPIRED',
];

describe('canTransfer', () => {
  it('allows exactly the statuses a driver can still be moved or added on', () => {
    const allowed = ALL_STATUSES.filter(canTransfer);
    expect(allowed.sort()).toEqual(
      ['ARRIVED', 'ASSIGNED', 'CONFIRMED', 'DRIVER_EN_ROUTE', 'SEARCHING'].sort(),
    );
  });

  it('refuses a started trip — that is a cancellation plus a new booking, not a transfer', () => {
    expect(canTransfer('STARTED')).toBe(false);
  });

  it('allows a confirmed booking, which is pre-assignment before dispatch ever rings', () => {
    expect(canTransfer('CONFIRMED')).toBe(true);
  });

  it('refuses every finished status', () => {
    for (const status of ['COMPLETED', 'CANCELLED_BY_CUSTOMER', 'NO_DRIVER_FOUND', 'EXPIRED'] as const) {
      expect(canTransfer(status)).toBe(false);
    }
  });
});

describe('isTransferSubmitDisabled', () => {
  it('is disabled with no driver selected', () => {
    expect(isTransferSubmitDisabled({ selected: null, isPending: false })).toBe(true);
  });

  it('is disabled while the mutation is pending', () => {
    expect(isTransferSubmitDisabled({ selected: 'drv_1', isPending: true })).toBe(true);
  });

  it('is enabled as soon as a driver is selected — the reason is optional', () => {
    expect(isTransferSubmitDisabled({ selected: 'drv_1', isPending: false })).toBe(false);
  });
});

describe('buildAssignPayload', () => {
  it('trims the reason and maps the fields the API expects', () => {
    expect(
      buildAssignPayload({ bookingId: 'bkg_1', driverId: 'drv_1', reason: '  Vehicle broke down  ' }),
    ).toEqual({ id: 'bkg_1', driverId: 'drv_1', reason: 'Vehicle broke down' });
  });

  it('leaves a blank reason out, so the server records its default', () => {
    expect(buildAssignPayload({ bookingId: 'bkg_1', driverId: 'drv_1', reason: '   ' })).toEqual({
      id: 'bkg_1',
      driverId: 'drv_1',
    });
  });
});

describe('transferDialogCopy', () => {
  it('offers a straight assignment when nobody has the booking yet', () => {
    const copy = transferDialogCopy(null, 'SEARCHING');
    expect(copy.title).toBe('Assign a driver');
    expect(copy.description).toMatch(/bypassing the search/i);
  });

  it('never claims to bypass a search on a booking nothing is searching for', () => {
    const copy = transferDialogCopy(null, 'CONFIRMED');
    expect(copy.description).not.toMatch(/bypassing/i);
    expect(copy.description).toMatch(/closer to the pickup time/i);
  });

  it('names the outgoing driver when handing off an existing assignment', () => {
    const copy = transferDialogCopy({
      id: 'drv_1',
      name: 'Ramesh Chettri',
      photo_url: null,
      rating: null,
      rating_count: 0,
      phone: '+919800000000',
    });
    expect(copy.title).toBe('Transfer to another driver');
    expect(copy.description).toContain('Ramesh Chettri');
  });

  it('falls back to a generic name when the outgoing driver has none on file', () => {
    const copy = transferDialogCopy({
      id: 'drv_1',
      name: null,
      photo_url: null,
      rating: null,
      rating_count: 0,
      phone: '+919800000000',
    });
    expect(copy.description).toContain('The current driver');
  });
});
