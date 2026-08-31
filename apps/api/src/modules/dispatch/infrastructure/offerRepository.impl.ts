import mongoose from 'mongoose';
import type { DeliveryChannel } from '@driverzone/contracts';
import type { DispatchOffer, OfferStatus } from '../domain/offer.entity.js';
import type { NewOffer, OfferRepositoryPort } from '../domain/ports.js';
import { DispatchOfferModel, type DispatchOfferDoc } from './dispatchOffer.model.js';

function toEntity(doc: DispatchOfferDoc): DispatchOffer {
  return {
    id: String(doc._id),
    bookingId: String(doc.bookingId),
    driverId: String(doc.driverId),
    wave: doc.wave,
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

  async findLiveForDriver(driverId: string): Promise<DispatchOffer | null> {
    if (!mongoose.isValidObjectId(driverId)) return null;
    const doc = await DispatchOfferModel.findOne({
      driverId,
      status: 'SENT',
      expiresAt: { $gt: new Date() },
    });
    return doc === null ? null : toEntity(doc.toObject() as DispatchOfferDoc);
  }

  async listForBooking(bookingId: string): Promise<DispatchOffer[]> {
    if (!mongoose.isValidObjectId(bookingId)) return [];
    const docs = await DispatchOfferModel.find({ bookingId }).sort({ createdAt: 1 });
    return docs.map((doc) => toEntity(doc.toObject() as DispatchOfferDoc));
  }

  async driverIdsOffered(bookingId: string): Promise<string[]> {
    if (!mongoose.isValidObjectId(bookingId)) return [];
    const docs = await DispatchOfferModel.find({ bookingId }).select('driverId');
    return docs.map((doc) => String(doc.driverId));
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

  async recordDelivery(offerId: string, via: DeliveryChannel): Promise<void> {
    await DispatchOfferModel.findByIdAndUpdate(offerId, {
      $set: { deliveredVia: via, deliveredAt: via === 'NONE' ? null : new Date() },
    });
  }
}
