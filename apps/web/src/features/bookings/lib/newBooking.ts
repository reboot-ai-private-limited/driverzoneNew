import type {
  AdminCreateBookingRequest,
  AdminPaymentMode,
  AdminCreateQuoteRequest,
  CarCategory,
  Direction,
  VehicleTypePreference,
} from '@driverzone/contracts';

/**
 * The non-visual rules behind `NewBookingScreen` — the admin booking a trip for a customer. Kept
 * out of the component so they can be tested under `node`, the same convention `lib/transfer.ts`
 * follows.
 */

/** One end of a trip: the coordinate the server prices and the words everyone reads. */
export interface TripPoint {
  lat: number;
  lng: number;
  address: string;
}

export type When = 'NOW' | 'LATER';

export interface TripDraft {
  pickup: TripPoint | null;
  drop: TripPoint | null;
  when: When;
  /** `YYYY-MM-DDTHH:mm`, the value of a `datetime-local` input, read as IST. */
  scheduledLocal: string;
  direction: Direction;
  /** Same format as `scheduledLocal`. Outstation round trips only. */
  returnLocal: string;
  insurance: boolean;
}

/**
 * A place's own name, then its address — "Hakimpara, Haren Mukherjee Road, Siliguri" — with the
 * name dropped when the address already starts with it. Mirrors what the customer app shows for a
 * searched place, so a booking made in the panel reads the same as one made on a phone.
 */
export function placeLabel(name: string | null | undefined, address: string | null | undefined): string {
  const n = name?.trim() ?? '';
  const a = address?.trim() ?? '';
  if (n === '') return a;
  if (a === '' || a.toLowerCase().startsWith(n.toLowerCase())) return a === '' ? n : a;
  return `${n}, ${a}`;
}

/**
 * The label for a point set by CLICKING or DRAGGING on the map, from a reverse-geocode answer.
 *
 * Skips Plus Codes ("PC8G+2C9, Siliguri") — Google puts one first whenever the point has no street
 * address, which in Siliguri is often, and nobody can read one. The first proper address wins.
 * Null when there is nothing better than the coordinate.
 */
export function pointLabelFromGeocode(
  results: ReadonlyArray<{ formatted_address: string; types: readonly string[] }>,
): string | null {
  const best = results.find((r) => !r.types.includes('plus_code') && r.formatted_address.trim() !== '');
  return best === undefined ? null : best.formatted_address.trim();
}

/**
 * A `datetime-local` value as an instant, read in IST. The panel is used from India and every
 * time it shows is IST (`BookingDetailsScreen` says so on the page), so a pickup typed as 09:00 is
 * 09:00 in Siliguri whatever the admin's laptop clock zone is set to.
 */
export function istLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const date = new Date(`${local}:00+05:30`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Why the quote cannot be asked for yet, or null when it can. Shown under the button. */
export function quoteBlocker(draft: TripDraft, now: Date = new Date()): string | null {
  if (draft.pickup === null) return 'Choose a pickup location.';
  if (draft.drop === null) return 'Choose a destination.';
  if (draft.when === 'LATER') {
    const at = istLocalToIso(draft.scheduledLocal);
    if (at === null) return 'Choose the pickup date and time.';
    if (new Date(at).getTime() <= now.getTime()) return 'The pickup time has to be in the future.';
  }
  if (draft.direction === 'ROUND_TRIP' && draft.returnLocal !== '') {
    const back = istLocalToIso(draft.returnLocal);
    const out = draft.when === 'LATER' ? istLocalToIso(draft.scheduledLocal) : now.toISOString();
    if (back === null) return 'The return time is not a valid date.';
    if (out !== null && new Date(back).getTime() <= new Date(out).getTime()) {
      return 'The return has to be after the pickup.';
    }
  }
  return null;
}

/**
 * The quote request, exactly as the customer app would send it plus whose quote it is.
 *
 * `direction` and `returnAt` are always SENT for a round trip and never for anything else; the
 * server ignores direction on an incity trip, so sending ONE_WAY by default is harmless and keeps
 * an outstation one-way trip from depending on a server default.
 */
export function buildQuoteRequest(customerId: string, draft: TripDraft): AdminCreateQuoteRequest {
  if (draft.pickup === null || draft.drop === null) {
    throw new Error('buildQuoteRequest called before both points were chosen');
  }
  const scheduledAt = draft.when === 'LATER' ? istLocalToIso(draft.scheduledLocal) : null;
  const returnAt =
    draft.direction === 'ROUND_TRIP' && draft.returnLocal !== ''
      ? istLocalToIso(draft.returnLocal)
      : null;

  return {
    customer_id: customerId,
    pickup: { lat: draft.pickup.lat, lng: draft.pickup.lng },
    drop: { lat: draft.drop.lat, lng: draft.drop.lng },
    direction: draft.direction,
    insurance: draft.insurance,
    ...(scheduledAt === null ? {} : { scheduledAt }),
    ...(returnAt === null ? {} : { returnAt }),
  };
}

export function buildCreateBookingRequest(input: {
  customerId: string;
  quoteId: string;
  pickup: TripPoint;
  drop: TripPoint;
  carCategory: CarCategory;
  vehicleType: VehicleTypePreference;
  paymentMode: AdminPaymentMode;
  paymentReference: string;
}): AdminCreateBookingRequest {
  const reference = input.paymentReference.trim();
  return {
    customer_id: input.customerId,
    quote_id: input.quoteId,
    pickup_address: input.pickup.address.trim(),
    drop_address: input.drop.address.trim(),
    car_category: input.carCategory,
    vehicle_type: input.vehicleType,
    payment_mode: input.paymentMode,
    // Only a prepaid booking carries a reference — on cash there is nothing it would refer to.
    ...(input.paymentMode === 'PREPAID' && reference !== '' ? { payment_reference: reference } : {}),
  };
}

/**
 * An Indian mobile number as the server wants it — E.164. Accepts what an admin actually types:
 * `98765 43210`, `09876543210`, `+91 98765-43210`. Returns null for anything that is not a
 * ten-digit Indian mobile, so the form can say so before the server does.
 */
export function toIndianE164(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const local =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}
