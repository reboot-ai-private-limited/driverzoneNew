import type { CarCategory, DeliveryChannel, VehicleTypePreference } from '@driverzone/contracts';
import type { DispatchOffer, DriverCandidate, OfferStatus } from './offer.entity.js';

export interface NewOffer {
  bookingId: string;
  driverId: string;
  wave: number;
  score: number;
  distanceMetres: number;
  expiresAt: Date;
}

export interface OfferRepositoryPort {
  createMany(offers: readonly NewOffer[]): Promise<DispatchOffer[]>;

  findById(offerId: string): Promise<DispatchOffer | null>;

  /**
   * Every offer currently ringing for this driver, SOONEST-EXPIRING FIRST — the recovery path
   * after an app restart mid-offer, and the answer `GET /driver/offers` sends straight through.
   *
   * PLURAL (2026-09-04, was `findLiveForDriver`, singular). A driver can legitimately hold more
   * than one live offer at once — nothing in `MongoDriverPool` excludes a driver who already has
   * an open offer or is mid-trip, and that is deliberate. Returning only one, arbitrarily, is what
   * let the driver app's ring screen show a different offer than the one it was about to act on.
   * Sorted so every caller agrees on which offer is the more urgent one without re-deriving it.
   */
  findAllLiveForDriver(driverId: string): Promise<DispatchOffer[]>;

  listForBooking(bookingId: string): Promise<DispatchOffer[]>;

  /** Every driver already offered this booking, so a later wave does not ring them again. */
  driverIdsOffered(bookingId: string): Promise<string[]>;

  /**
   * Is anything still ringing in this wave?
   *
   * FALSE MEANS THE WAVE IS SPENT and there is nothing left to wait for. Declining used to do
   * nothing but write a row: the booking then sat out the whole TTL ringing nobody, which is most
   * visible on the favourite wave, where one driver saying no could cost a customer a full minute
   * of "Searching…" for a decision that was already made.
   */
  hasLiveOffersInWave(bookingId: string, wave: number): Promise<boolean>;

  /**
   * Has a LATER wave already been rung for this booking?
   *
   * The guard on a stale wave timeout. Once the last decline in a wave advances the search, that
   * wave's BullMQ job is still sitting in Redis and will fire on schedule — and without this it
   * would widen the search a second time, ringing an extra wave nobody asked for. Deliberately a
   * repository question rather than a job deletion: it stays true even if the Redis delete fails,
   * and there is no second place for the two to disagree.
   */
  hasOffersAfterWave(bookingId: string, wave: number): Promise<boolean>;

  /**
   * Answers an offer, but only if it is still `SENT` and unexpired.
   *
   * A compare-and-swap: a driver tapping Accept as the TTL expires must resolve to exactly one
   * outcome, not to an accept applied on top of a lapse.
   */
  respond(offerId: string, to: OfferStatus, now: Date): Promise<DispatchOffer | null>;

  /** Withdraws every other live offer once one is accepted. Never counts against anyone. */
  supersedeOthers(bookingId: string, exceptOfferId: string): Promise<DispatchOffer[]>;

  /**
   * Releases an offer this driver WON but could not turn into a booking.
   *
   * Separate from `respond` because that one only ever swaps out of `SENT`, and by this point the
   * offer is already `ACCEPTED` — routing the rollback through it would silently do nothing and
   * leave a phantom accepted offer against a booking the driver does not have.
   */
  releaseAccepted(offerId: string): Promise<DispatchOffer | null>;

  /** Marks a whole wave lapsed when its timeout fires. */
  lapseWave(bookingId: string, wave: number, now: Date): Promise<DispatchOffer[]>;

  recordDelivery(offerId: string, via: DeliveryChannel): Promise<void>;

  /**
   * Records that an admin handed this booking to this driver by hand.
   *
   * WRITTEN STRAIGHT AS `ACCEPTED`, because it already has been — the booking claim committed
   * before this is called. There was no ring, so there is nothing to expire and no TTL that could
   * mean anything; `expiresAt` is set to now for the same reason.
   *
   * It exists for two jobs: the assignment is visible in the same place every other assignment is,
   * and `driverIdsOffered` covers this driver so a later wave cannot ring them for a booking they
   * were already given. Idempotent against the `{ bookingId, driverId }` unique index — assigning
   * the same driver twice records one row, not an error.
   */
  recordManualAssignment(bookingId: string, driverId: string): Promise<void>;
}

export interface DriverPoolQuery {
  pickup: { lat: number; lng: number };
  radiusMetres: number;
  /** A hill destination needs a driver verified for hills, not merely one who says they can. */
  requireHillVerified: boolean;
  /**
   * The competencies this trip demands, from the booking.
   *
   * NULL MEANS THE BOOKING NEVER STATED ONE — only true of rows predating the choice — and the
   * filter is skipped for it. That is not the same as an empty driver preference, which means the
   * DRIVER never stated one and is excluded: a trip with no stated requirement can be met by
   * anyone, a driver with no stated competency can meet nothing.
   */
  carCategory: CarCategory | null;
  vehicleType: VehicleTypePreference | null;
  /** Drivers already rung for this booking. */
  excludeDriverIds: readonly string[];
  /**
   * When present, NOBODY OUTSIDE THIS LIST is considered. The favourite wave, and nothing else —
   * every ordinary wave leaves it undefined.
   *
   * It NARROWS and never widens. Every other gate in this query still applies to the drivers in
   * it: a favourite who is off duty, unverified, in debt, out of position or not competent for
   * this car is no more eligible than a stranger in the same state. Being chosen by a customer
   * is a preference about people, not an exemption from being able to do the job.
   *
   * An EMPTY ARRAY means nobody, which is why the caller skips the query entirely rather than
   * passing one — see `runWave.usecase.ts`.
   */
  restrictToDriverIds?: readonly string[] | undefined;
  /** A driver owing more than this is not offered work until they settle. */
  maxNegativeBalancePaise: number;
  now: Date;
}

/**
 * Finding drivers who could take this trip.
 *
 * Its own port because the implementation is expected to change shape: today it is a Mongo
 * geospatial query, and `docs/LLD/architecture.md` intends a Redis `GEOSEARCH` over live
 * positions with Mongo used only to filter the shortlist. That swap should not reach the wave
 * algorithm.
 */
export interface DriverPoolPort {
  findEligible(query: DriverPoolQuery): Promise<DriverCandidate[]>;
}
