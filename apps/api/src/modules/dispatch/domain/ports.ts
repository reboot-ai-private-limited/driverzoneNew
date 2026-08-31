import type { DeliveryChannel } from '@driverzone/contracts';
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

  /** The driver's current ringing offer, for the recovery path after an app restart mid-offer. */
  findLiveForDriver(driverId: string): Promise<DispatchOffer | null>;

  listForBooking(bookingId: string): Promise<DispatchOffer[]>;

  /** Every driver already offered this booking, so a later wave does not ring them again. */
  driverIdsOffered(bookingId: string): Promise<string[]>;

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
}

export interface DriverPoolQuery {
  pickup: { lat: number; lng: number };
  radiusMetres: number;
  /** A hill destination needs a driver verified for hills, not merely one who says they can. */
  requireHillVerified: boolean;
  /** Drivers already rung for this booking. */
  excludeDriverIds: readonly string[];
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
