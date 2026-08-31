import mongoose from 'mongoose';
import type { Quote, QuoteSource } from '../domain/quote.entity.js';
import type { NewQuote, QuoteRepositoryPort } from '../domain/quoteRepository.port.js';
import type { FareBreakdown } from '../../pricing/pricing.public.js';
import { QuoteModel, type QuoteDoc } from './quote.model.js';

function toEntity(doc: QuoteDoc): Quote {
  return {
    id: String(doc._id),
    customerId: String(doc.customerId),
    serviceType: doc.serviceType as Quote['serviceType'],
    pickup: doc.pickup,
    drop: doc.drop,
    scheduledAt: doc.scheduledAt,
    direction: (doc.direction ?? null) as Quote['direction'],
    distanceKm: doc.distanceKm ?? null,
    includedMinutes: doc.includedMinutes ?? null,
    source: doc.source as QuoteSource,
    fare: doc.fare as FareBreakdown,
    expiresAt: doc.expiresAt,
    consumedBy: doc.consumedBy ? String(doc.consumedBy) : null,
    createdAt: doc.createdAt,
  };
}

export class MongoQuoteRepository implements QuoteRepositoryPort {
  async createMany(quotes: readonly NewQuote[]): Promise<Quote[]> {
    if (quotes.length === 0) return [];

    const docs = await QuoteModel.insertMany(
      quotes.map((quote) => ({
        ...quote,
        customerId: new mongoose.Types.ObjectId(quote.customerId),
      })),
    );

    return docs.map((doc) => toEntity(doc.toObject() as QuoteDoc));
  }

  async findById(id: string): Promise<Quote | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await QuoteModel.findById(id);
    return doc === null ? null : toEntity(doc.toObject() as QuoteDoc);
  }

  /**
   * The whole of single-consumption, in one filter.
   *
   * `consumedBy: null` and `expiresAt: { $gt: now }` are both in the QUERY, not checked
   * beforehand — that is what makes this atomic. Two Confirm taps arriving together both run this
   * update; Mongo applies one, and the other gets `null` back and is told about the booking that
   * won rather than creating a second.
   */
  async consume(id: string, bookingId: string, now: Date): Promise<Quote | null> {
    if (!mongoose.isValidObjectId(id)) return null;

    const doc = await QuoteModel.findOneAndUpdate(
      { _id: id, consumedBy: null, expiresAt: { $gt: now } },
      { $set: { consumedBy: new mongoose.Types.ObjectId(bookingId) } },
      { new: true },
    );

    return doc === null ? null : toEntity(doc.toObject() as QuoteDoc);
  }
}
