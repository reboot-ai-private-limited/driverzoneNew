import mongoose from 'mongoose';
import type { DeliveryChannel } from '@driverzone/contracts';
import { MANUAL_ASSIGNMENT_WAVE } from '../domain/offer.entity.js';
import type { DispatchAttempt, DispatchOffer, OfferStatus } from '../domain/offer.entity.js';
import type { NewOffer, OfferRepositoryPort } from '../domain/ports.js';
import { DispatchOfferModel, type DispatchOfferDoc } from './dispatchOffer.model.js';

function toEntity(doc: DispatchOfferDoc): DispatchOffer {
  return {
    id: String(doc._id),
    bookingId: String(doc.bookingId),
    driverId: String(doc.driverId),
    wave: doc.wave,
    attempt: doc.attempt as DispatchOffer['attempt'],
    status: doc.status as OfferStatus,
    score: doc.score,
    distanceMetres: doc.distanceMetres,
    expiresAt: doc.expiresAt,
    deliveredVia: doc.deliveredVia as DispatchOffer['deliveredVia'],
    deliveredAt: doc.deliveredAt ?? null,
    respondedAt: doc.respondedAt ?? null,
    createdAt: doc.createdAt,
  };
}

export class MongoOfferRepository implements OfferRepositoryPort {
  async createMany(offers: readonly NewOffer[]): Promise<DispatchOffer[]> {
    if (offers.length === 0) return [];

    /*
     * `ordered: false` so one driver who somehow slipped past the exclusion list — a wave racing
     * a previous wave's write — does not stop the rest of the batch being rung. The unique index
     * is the guard; this is how a collision is tolerated rather than fatal.
     */
    const docs = await DispatchOfferModel.insertMany(
      offers.map((offer) => ({
        ...offer,
        bookingId: new mongoose.Types.ObjectId(offer.bookingId),
        driverId: new mongoose.Types.ObjectId(offer.driverId),
      })),
      { ordered: false },
    ).catch((error: unknown) => {
      const inserted = (error as { insertedDocs?: DispatchOfferDoc[] }).insertedDocs;
      if (inserted === undefined) throw error;
      return inserted;
    });

    return docs.map((doc) =>
      toEntity(('toObject' in doc ? doc.toObject() : doc) as DispatchOfferDoc),
    );
  }

  async findById(offerId: string): Promise<DispatchOffer | null> {
    if (!mongoose.isValidObjectId(offerId)) return null;
    const doc = await DispatchOfferModel.findById(offerId);
    return doc === null ? null : toEntity(doc.toObject() as DispatchOfferDoc);
  }

  /** Sorted soonest-expiring first — see the port for why this matters now that it can be several. */
  async findAllLiveForDriver(driverId: string): Promise<DispatchOffer[]> {
    if (!mongoose.isValidObjectId(driverId)) return [];
    const docs = await DispatchOfferModel.find({
      driverId,
      status: 'SENT',
      expiresAt: { $gt: new Date() },
    }).sort({ expiresAt: 1 });
    return docs.map((doc) => toEntity(doc.toObject() as DispatchOfferDoc));
  }

  async listForBooking(bookingId: string): Promise<DispatchOffer[]> {
    if (!mongoose.isValidObjectId(bookingId)) return [];
    const docs = await DispatchOfferModel.find({ bookingId }).sort({ createdAt: 1 });
    return docs.map((doc) => toEntity(doc.toObject() as DispatchOfferDoc));
  }

  async driverIdsOffered(bookingId: string, attempt?: DispatchAttempt): Promise<string[]> {
    if (!mongoose.isValidObjectId(bookingId)) return [];
    const docs = await DispatchOfferModel.find({
      bookingId,
      // Absent means "every driver ever offered", which is what superseding a race wants.
      ...(attempt === undefined ? {} : { attempt }),
    }).select('driverId');
    return docs.map((doc) => String(doc.driverId));
  }

  /**
   * Both of these are existence questions, so both use `.exists()` — Mongo stops at the first
   * match, and the `{ bookingId, wave, status }` index already serves them.
   *
   * `hasLiveOffersInWave` does NOT check `expiresAt`. An offer past its TTL that nothing has
   * lapsed yet is still SENT, and the timeout job is what resolves it — treating it as dead here
   * would race that job into ringing the next wave twice.
   */
  async hasLiveOffersInWave(bookingId: string, wave: number): Promise<boolean> {
    if (!mongoose.isValidObjectId(bookingId)) return false;
    return (await DispatchOfferModel.exists({ bookingId, wave, status: 'SENT' })) !== null;
  }

  async hasOffersAfterWave(bookingId: string, wave: number): Promise<boolean> {
    if (!mongoose.isValidObjectId(bookingId)) return false;
    return (await DispatchOfferModel.exists({ bookingId, wave: { $gt: wave } })) !== null;
  }

  /**
   * `status: 'SENT'` and `expiresAt: { $gt: now }` are in the FILTER.
   *
   * A driver tapping Accept as the timeout job fires must resolve one way or the other, never
   * both — so the expiry is part of the swap rather than a check before it.
   */
  async respond(offerId: string, to: OfferStatus, now: Date): Promise<DispatchOffer | null> {
    if (!mongoose.isValidObjectId(offerId)) return null;

    const doc = await DispatchOfferModel.findOneAndUpdate(
      { _id: offerId, status: 'SENT', expiresAt: { $gt: now } },
      { $set: { status: to, respondedAt: now } },
      { new: true },
    );

    return doc === null ? null : toEntity(doc.toObject() as DispatchOfferDoc);
  }

  async supersedeOthers(bookingId: string, exceptOfferId: string): Promise<DispatchOffer[]> {
    const live = await DispatchOfferModel.find({
      bookingId,
      _id: { $ne: exceptOfferId },
      status: 'SENT',
    });

    await DispatchOfferModel.updateMany(
      { bookingId, _id: { $ne: exceptOfferId }, status: 'SENT' },
      { $set: { status: 'SUPERSEDED' } },
    );

    return live.map((doc) => toEntity(doc.toObject() as DispatchOfferDoc));
  }

  async releaseAccepted(offerId: string): Promise<DispatchOffer | null> {
    if (!mongoose.isValidObjectId(offerId)) return null;

    const doc = await DispatchOfferModel.findOneAndUpdate(
      { _id: offerId, status: 'ACCEPTED' },
      { $set: { status: 'SUPERSEDED' } },
      { new: true },
    );

    return doc === null ? null : toEntity(doc.toObject() as DispatchOfferDoc);
  }

  async lapseWave(bookingId: string, wave: number, _now: Date): Promise<DispatchOffer[]> {
    const live = await DispatchOfferModel.find({ bookingId, wave, status: 'SENT' });
    await DispatchOfferModel.updateMany(
      { bookingId, wave, status: 'SENT' },
      { $set: { status: 'LAPSED' } },
    );
    return live.map((doc) => toEntity(doc.toObject() as DispatchOfferDoc));
  }

  /**
   * `updateOne` with `upsert`, not `create`. The `{ bookingId, driverId }` unique index means a
   * second assignment of the same driver would throw on an insert — and "they already have it"
   * is not an error worth failing a committed transfer over.
   */
  async recordManualAssignment(bookingId: string, driverId: string): Promise<void> {
    if (!mongoose.isValidObjectId(bookingId) || !mongoose.isValidObjectId(driverId)) return;

    const now = new Date();

    /*
     * SCOPED TO `FINAL`, which the upsert now needs in order to have one deterministic target.
     * With the unique index carrying `attempt`, a driver may hold two rows for one booking — the
     * early ring's offer and the final ring's — and an unscoped `updateOne` would pick whichever
     * Mongo reached first and quietly rewrite an early offer as an admin assignment.
     *
     * `FINAL` is also the truthful label: an admin naming a driver is the last word on the
     * booking, not part of the speculative early search.
     */
    await DispatchOfferModel.updateOne(
      { bookingId, driverId, attempt: 'FINAL' },
      {
        $set: {
          wave: MANUAL_ASSIGNMENT_WAVE,
          status: 'ACCEPTED',
          score: 0,
          distanceMetres: 0,
          // Nothing rang, so there is no TTL that could mean anything and nothing to expire.
          expiresAt: now,
          respondedAt: now,
          // NOT a delivery failure: nobody tried to reach them, an admin simply gave them the
          // trip. `deliveredVia` drives the infrastructure-failure metric, and a manual
          // assignment filed as NONE would read as a push we failed to send.
          deliveredVia: 'BOTH',
          deliveredAt: now,
        },
      },
      { upsert: true },
    );
  }

  async recordDelivery(offerId: string, via: DeliveryChannel): Promise<void> {
    await DispatchOfferModel.findByIdAndUpdate(offerId, {
      $set: { deliveredVia: via, deliveredAt: via === 'NONE' ? null : new Date() },
    });
  }
}
