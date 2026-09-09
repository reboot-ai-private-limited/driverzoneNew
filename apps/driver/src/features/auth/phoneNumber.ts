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

/**
 * Whatever the driver typed → the bare 10-digit national number.
 *
 * The field already shows a fixed `+91` beside it, so the number alone is what it is asking for —
 * but plenty of people write their number the way they say it, country code and all, and one that
 * arrives from a password manager or a paste almost always carries it. Every one of these has to
 * land on the same ten digits:
 *
 *     9876543210        +91 98765 43210        919876543210        09876543210
 *
 * **The country code is stripped only when what remains could still be a full number.** `91` is a
 * legal opening for a real Indian mobile — `9198765432` is ten digits beginning 9 — so a bare
 * ten-digit number is never touched, however it starts. Only a string too long to be national in
 * the first place can lose a prefix.
 *
 * THE ORDER HERE IS THE FIX. This used to cap at ten digits BEFORE looking for the prefix, which
 * meant a driver typing `919876543210` was truncated to `9198765432` — a number that passes
 * `isValidIndianMobile` because it is ten digits starting with 9. So they got no error, and an
 * OTP was sent to someone else's handset. Silent and wrong beats loud and wrong every time, and
 * this was the silent kind.
 */
export function normaliseInput(raw: string): string {
  let digits = raw.replace(/[^0-9]/g, '');

  // The country code, however it arrived — `+91`, `91`, or spaced out.
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);

  // The domestic trunk prefix. `09876543210` is how a great many people write it down, and it is
  // never part of the number itself.
  if (digits.length > 10 && digits.startsWith('0')) digits = digits.slice(1);

  return digits.slice(0, 10);
}
