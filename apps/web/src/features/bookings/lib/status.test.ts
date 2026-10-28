import { describe, expect, it } from 'vitest';
import { paymentModeLabel } from './status';

describe('paymentModeLabel', () => {
  it('reads each mode', () => {
    expect(paymentModeLabel('CASH')).toBe('Cash');
    expect(paymentModeLabel('PREPAID')).toBe('Prepaid (paid offline)');
    expect(paymentModeLabel(null)).toBe('Not selected');
  });

  it('calls an ordinary online payment Online (UPI)', () => {
    expect(paymentModeLabel('UPI')).toBe('Online (UPI)');
    expect(paymentModeLabel('UPI', { channel: 'ORDER', provider_payment_id: 'pay_1' })).toBe('Online (UPI)');
  });

  it('says so when the customer paid by scanning the driver’s QR', () => {
    expect(paymentModeLabel('UPI', { channel: 'QR', provider_payment_id: 'pay_1' })).toBe(
      'UPI (QR scanned at the trip)',
    );
  });

  it('does not claim a QR before any payment has been captured', () => {
    // Online was chosen, nothing has landed yet — there is no channel to report.
    expect(paymentModeLabel('UPI', null)).toBe('Online (UPI)');
  });
});
