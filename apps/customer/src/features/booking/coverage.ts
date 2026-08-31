import type { CoverageCheckResponse } from '@driverzone/contracts';

/**
 * THE ONE PLACE THE APP WRITES COVERAGE COPY, AND IT SHOULD NOT EXIST FOR LONG.
 *
 * `docs/LLD/api-contracts.md` specifies `GET /coverage/check` answering with a displayable
 * `message` and says plainly: *"The app should never have to build copy from a code — new
 * reasons then render correctly on old app versions."* That is the right rule.
 *
 * The endpoint as BUILT answers `{ covered, city, pickup }` (`CoverageCheckResponse` in
 * packages/contracts/src/zones.ts) and carries no message, so until it catches up the words have
 * to come from somewhere. Keeping every one of them in this file means the fix is deleting a
 * file rather than hunting sentences through a screen — and it keeps the divergence visible
 * instead of quietly spread around.
 *
 * The zone objects themselves are real data, not guesses: `pickup_charge_type` and
 * `pickup_charge_paise` come straight from the zone an admin configured.
 */

export type CoverageState =
  /** No pickup point set yet — nothing has been asked. */
  | { kind: 'idle' }
  | { kind: 'checking' }
  /** The request itself failed. Distinct from "not served", which is a successful answer. */
  | { kind: 'failed' }
  | { kind: 'served'; cityName: string | null; zoneName: string; chargePaise: number | null }
  | { kind: 'servedFree'; cityName: string | null; zoneName: string }
  /** Inside a city we cover, but no pickup zone reaches this point (FR-B2). */
  | { kind: 'noPickupZone'; cityName: string | null }
  /**
   * A pickup zone with no city above it. Z-1 is retired so nothing rejects this configuration
   * any more, but it is still incoherent, and FR-B4 says a customer must never be shown a
   * half-answer built on it.
   */
  | { kind: 'unresolved' };

export function toCoverageState(response: CoverageCheckResponse): CoverageState {
  const { city, pickup } = response;
  const cityName = city?.name ?? null;

  if (pickup === null) return { kind: 'noPickupZone', cityName };
  if (city === null) return { kind: 'unresolved' };

  if (pickup.pickup_charge_type === 'PAID') {
    return {
      kind: 'served',
      cityName,
      zoneName: pickup.name,
      chargePaise: pickup.pickup_charge_paise ?? null,
    };
  }
  return { kind: 'servedFree', cityName, zoneName: pickup.name };
}

export type CoverageTone = 'neutral' | 'good' | 'warn' | 'bad';

export interface CoverageCopy {
  tone: CoverageTone;
  title: string;
  body: string | null;
}

export function coverageCopy(state: CoverageState): CoverageCopy | null {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'checking':
      return { tone: 'neutral', title: 'Checking this area…', body: null };
    case 'failed':
      return {
        tone: 'neutral',
        title: 'Could not check this area',
        body: 'Check your connection and try again.',
      };
    case 'servedFree':
      return {
        tone: 'good',
        title: 'We have drivers in your area',
        body: inCity(state.cityName),
      };
    case 'served':
      return {
        tone: 'warn',
        title: 'Pickup charge applies here',
        body:
          state.chargePaise === null
            ? `${state.zoneName} is a paid pickup area. The charge is shown before you confirm.`
            : `${formatPaise(state.chargePaise)} for pickup from ${state.zoneName}, shown again before you confirm.`,
      };
    case 'noPickupZone':
      return {
        tone: 'bad',
        // The PRD's wording for FR-B2, near enough verbatim.
        title: "We don't have drivers at this pickup point yet",
        body:
          state.cityName === null
            ? 'Try a pickup point closer to a town we serve.'
            : `We are in ${state.cityName}, but not at this exact spot. Try moving the pin.`,
      };
    case 'unresolved':
      return {
        tone: 'bad',
        title: 'We could not confirm coverage here',
        body: 'Please try a different pickup point.',
      };
  }
}

function inCity(cityName: string | null): string | null {
  return cityName === null ? null : `Serving ${cityName}.`;
}

/**
 * Integer paise → a rupee string.
 *
 * Hand-rolled rather than `Intl.NumberFormat('en-IN')`: Hermes ships a reduced ICU on Android
 * and the lakh/crore grouping is exactly the locale data that goes missing, which would show a
 * customer `₹1,00,000` on one device and `₹100,000` on another. A pickup charge is a small round
 * figure, so the grouping this needs is trivial to do correctly here.
 *
 * The API pairs `amount_paise` with a server-rendered `amount_display` everywhere it can
 * (packages/contracts/src/http.ts) precisely so clients do not format money. `/coverage/check`
 * is one of the places it does not, which is the only reason this function exists.
 */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  const whole = Math.trunc(Math.abs(rupees));
  const fraction = Math.round((Math.abs(rupees) - whole) * 100);

  const digits = String(whole);
  // Indian grouping: the last three digits, then pairs. 1234567 → 12,34,567.
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const grouped = head.length > 0 ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}` : tail;

  const sign = rupees < 0 ? '-' : '';
  return fraction === 0
    ? `${sign}₹${grouped}`
    : `${sign}₹${grouped}.${String(fraction).padStart(2, '0')}`;
}
