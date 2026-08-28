/**
 * DOMAIN — the one place rupees and paise are allowed to meet.
 *
 * Every money value in `globalSettings` is a whole number of RUPEES. Everywhere else in this
 * codebase money is PAISE (docs/LLD/database-schema.md §Conventions) — `baseFarePaise`,
 * `pickupChargePaise`, every ledger amount. The settings collection is a deliberate exception
 * because these are ops-facing round figures and a paise field in an admin form is bad UX.
 *
 * That exception has exactly one dangerous shape:
 *
 *     const subtotal = price.baseFarePaise + settings['pricing.insurance_charge'];
 *
 * which is a silent 100× undercharge that still looks plausible on a receipt. `Rupees` below
 * makes that line a COMPILE ERROR.
 *
 * OPAQUE, not `number & { __unit: 'RUPEES' }`. The intersection form — the usual "branded type"
 * recipe — does not work here and it is worth saying why, because it looks like it does: an
 * intersection is still assignable to `number`, so `paise + branded` type-checks fine and only
 * assignment in the other direction is caught. Blocking the ARITHMETIC needs a type that is not a
 * number at all. At runtime a `Rupees` is an ordinary number and serialises as one; the object
 * shape below exists only for the compiler, which is why every conversion here is an unchecked
 * cast and why they all live in this file.
 */

declare const RUPEES: unique symbol;

export type Rupees = { readonly [RUPEES]: 'RUPEES' };

/** The conversion the rest of the fare engine wants. Exact on integers, which rupees always are. */
export function rupeesToPaise(amount: Rupees): number {
  return (amount as unknown as number) * 100;
}

/**
 * The raw number, for the rare caller that genuinely wants rupees — display, or comparing two
 * rupee amounts to each other. Reaching for this to do arithmetic against a paise value is the
 * exact bug the type exists to prevent, so it is worth a second look at any call site.
 */
export function rupeesValue(amount: Rupees): number {
  return amount as unknown as number;
}

/**
 * Brands a number already validated as whole rupees. Called by the snapshot builder and by
 * nothing else — a caller reaching for this is asserting a unit the type system was about to
 * check for them.
 */
export function asRupees(value: number): Rupees {
  return value as unknown as Rupees;
}
