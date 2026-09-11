/**
 * DOMAIN — a customer asking for one more day, and the driver's answer.
 *
 * WHY IT IS A REQUEST AND NOT AN ACT. A day extension commits somebody else's next 24 hours. The
 * customer decides they want it; the driver is the one who has to be there for it, and may have
 * a booking, a family or a return leg of their own the following morning. So an extension is
 * PENDING until the driver says yes, and nothing is charged until they do.
 *
 * WHY IT IS ITS OWN ROW RATHER THAN A COUNTER ON THE BOOKING. A trip can be extended more than
 * once, each time by a different amount if the package was repriced in between, and each with its
 * own answer from the driver. A counter would record the total and lose every one of those facts —
 * including which extension the driver actually agreed to.
 */

export const EXTENSION_STATUSES = [
  /** Asked for, waiting on the driver. */
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  /** The driver never answered before the window closed. Charges nobody. */
  'EXPIRED',
] as const;
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];

export interface BookingExtension {
  id: string;
  bookingId: string;
  customerId: string;
  driverId: string;
  status: ExtensionStatus;
  /**
   * What the customer pays for this one day, and what the driver earns from it — BOTH FROZEN AT
   * REQUEST TIME from the booking's own `fareSnapshot.fare.perDay`.
   *
   * Frozen for the same reason the fare snapshot itself is (invariant B-1): the customer was shown
   * a price and the driver was shown an earning, and a package repriced between the request and
   * the end of the trip must not change either. Reading them live at completion would settle an
   * amount neither party ever agreed to.
   */
  amountPaise: number;
  driverAmountPaise: number;
  requestedAt: Date;
  /** When the request lapses if the driver has not answered. */
  expiresAt: Date;
  respondedAt: Date | null;
}

/** Every extension that actually costs money. The rest are history. */
export function isBillable(extension: BookingExtension): boolean {
  return extension.status === 'ACCEPTED';
}

/**
 * What the accepted extensions on a booking add up to, and how many there are.
 *
 * ONE PLACE, because three callers need exactly this sum and they must agree: the receipt line,
 * what a cash driver collects at the door, and what the driver is credited in the ledger. Three
 * separate reductions is how the customer's bill and the driver's earnings drift apart.
 */
export function totalExtension(extensions: readonly BookingExtension[]): {
  days: number;
  amountPaise: number;
  driverAmountPaise: number;
} {
  return extensions.filter(isBillable).reduce(
    (sum, extension) => ({
      // One row is one day. The day count IS the row count, which is why a repeat extension is a
      // second row rather than an edit to the first.
      days: sum.days + 1,
      amountPaise: sum.amountPaise + extension.amountPaise,
      driverAmountPaise: sum.driverAmountPaise + extension.driverAmountPaise,
    }),
    { days: 0, amountPaise: 0, driverAmountPaise: 0 },
  );
}

/** `Extended — 2 extra days`. Built here so the receipt and the driver's card cannot disagree. */
export function extensionLabel(days: number): string {
  return `Extended — ${String(days)} extra ${days === 1 ? 'day' : 'days'}`;
}
