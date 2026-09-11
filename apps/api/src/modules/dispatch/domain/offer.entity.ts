/**
 * DOMAIN — an offer of one trip to one driver, and how the next driver is chosen.
 *
 * The riskiest subsystem in the product, guarding two failure modes: a booking that silently
 * hangs with no driver, and two drivers assigned to one trip. Everything here exists for one or
 * the other.
 */

export const OFFER_STATUSES = [
  /** Ringing. */
  'SENT',
  'ACCEPTED',
  'DECLINED',
  /** The driver never answered before the TTL. */
  'LAPSED',
  /** Another driver won, so this offer was withdrawn. NOT the driver's fault. */
  'SUPERSEDED',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/**
 * The statuses that count against a driver's acceptance rate.
 *
 * `SUPERSEDED` is absent and that is the whole point: losing a race must never be held against
 * someone who did everything right and was merely slower. `LAPSED` is present only when the offer
 * was actually DELIVERED — an undelivered offer is an infrastructure failure of ours, which is
 * why `deliveredVia` is recorded at all.
 */
export const COUNTS_AGAINST_ACCEPTANCE: readonly OfferStatus[] = ['DECLINED', 'LAPSED'];

export interface DispatchOffer {
  id: string;
  bookingId: string;
  driverId: string;
  wave: number;
  status: OfferStatus;
  score: number;
  distanceMetres: number;
  expiresAt: Date;
  deliveredVia: 'SOCKET' | 'FCM' | 'BOTH' | 'NONE';
  deliveredAt: Date | null;
  respondedAt: Date | null;
  createdAt: Date;
}

/**
 * The `wave` an admin's manual assignment is recorded under.
 *
 * NEGATIVE, so it can never collide with a real one: 0 is the favourite wave and 1 upwards are the
 * radius ladder. It says "no wave chose this driver, a person did" — which matters because the
 * dispatch metrics read `wave` to judge the ranker, and a hand-picked assignment filed as wave 1
 * would look like the ranker's work.
 */
export const MANUAL_ASSIGNMENT_WAVE = -1;

/**
 * How far wave `n` looks. Doubles each time, from the configured base.
 *
 * Widening fast is deliberate: a wave that finds nobody has cost the booking its whole TTL, so
 * the cheapest thing to do is reach much further rather than slightly further.
 */
export function radiusForWave(wave: number, baseRadiusMetres: number): number {
  return baseRadiusMetres * 2 ** (wave - 1);
}

export interface DriverCandidate {
  driverId: string;
  distanceMetres: number;
  /** Rolling 30-day acceptance rate, 0–1. Null for a driver with no history yet. */
  acceptanceRate: number | null;
  /** 1–5. Null for a driver with no ratings yet. */
  rating: number | null;
  /** Minutes since their last trip ended. */
  idleMinutes: number;
}

/**
 * Ranks a candidate for this booking.
 *
 * The weights are from docs/LLD/dispatch-and-assignment.md. Proximity dominates because it is
 * what the customer actually experiences; the rest breaks ties among drivers who are all close
 * enough. A new driver with no history is treated as AVERAGE rather than as zero — scoring them
 * bottom would mean they never get a trip and so never acquire the history that would fix it.
 */
export function scoreCandidate(candidate: DriverCandidate, radiusMetres: number): number {
  const proximity = 1 - Math.min(1, candidate.distanceMetres / radiusMetres);
  const acceptance = candidate.acceptanceRate ?? 0.5;
  const rating = candidate.rating === null ? 0.5 : clamp01((candidate.rating - 3) / 2);
  const idle = Math.min(1, candidate.idleMinutes / 60);

  return 0.45 * proximity + 0.3 * acceptance + 0.15 * rating + 0.1 * idle;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Highest score first. Ties broken by distance, so the ordering is total and reproducible. */
export function rankCandidates(
  candidates: readonly DriverCandidate[],
  radiusMetres: number,
): Array<DriverCandidate & { score: number }> {
  return candidates
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, radiusMetres) }))
    .sort((a, b) => b.score - a.score || a.distanceMetres - b.distanceMetres);
}
