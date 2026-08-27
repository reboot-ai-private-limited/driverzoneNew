/**
 * The API accepts E.164 only — `/^\+[1-9]\d{7,14}$/`, per
 * apps/api/src/modules/identity/interface/identity.validation.ts. The UI collects a bare
 * 10-digit national number with a `+91` prefix beside it, so the two forms are converted here
 * rather than in a screen, and every screen that shows a number uses the same formatter.
 */
export const INDIA_DIALLING_CODE = '+91';

/** Indian mobile numbers are 10 digits and begin 6-9. Landlines and shortcodes cannot receive SMS. */
const INDIA_MOBILE = /^[6-9]\d{9}$/;

export function isValidIndianMobile(national: string): boolean {
  return INDIA_MOBILE.test(national);
}

/** `9876543210` → `+919876543210`. */
export function toE164(national: string): string {
  return `${INDIA_DIALLING_CODE}${national}`;
}

/** `+919876543210` → `+91 98765 43210`, the grouping used on the OTP screen. */
export function formatForDisplay(e164: string): string {
  const digits = e164.replace(/^\+91/, '');
  if (digits.length !== 10) return e164;
  return `${INDIA_DIALLING_CODE} ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** Keeps digits only, capped at 10 — so a pasted "+91 98765 43210" lands correctly in the field. */
export function normaliseInput(raw: string): string {
  return raw.replace(/[^0-9]/g, '').replace(/^91(?=\d{10}$)/, '').slice(0, 10);
}
