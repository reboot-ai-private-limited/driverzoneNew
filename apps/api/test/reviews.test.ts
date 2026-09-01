import { describe, expect, it } from 'vitest';
import { AppError } from '../src/shared/errors/AppError.js';
import type { Booking, BookingReviewContract } from '../src/modules/bookings/bookings.public.js';
import type { SettingsPublicContract } from '../src/modules/settings/settings.public.js';
import type { RatingCacheContract } from '../src/modules/identity/identity.public.js';
import type {
  AdminReviewFilter,
  NewReview,
  Review,
  ReviewRepositoryPort,
} from '../src/modules/reviews/domain/reviewRepository.port.js';
import { RateTripUseCase } from '../src/modules/reviews/application/useCases/rateTrip.usecase.js';
import { PublishReviewsUseCase } from '../src/modules/reviews/application/useCases/publishReviews.usecase.js';

const CUSTOMER = 'c00000000000000000000001';
const DRIVER = 'd00000000000000000000001';
const BOOKING = 'b00000000000000000000001';

const WINDOW_HOURS = 24;

/** An in-memory stand-in for the `reviews` collection, including its unique index. */
function fakeRepo(seed: Review[] = []) {
  const rows: Review[] = [...seed];
  let nextId = seed.length + 1;

  const repo: ReviewRepositoryPort = {
    createReview(data: NewReview): Promise<Review> {
      // The `{bookingId, reviewerId}` unique index, as Mongo would report it.
      if (rows.some((r) => r.bookingId === data.bookingId && r.reviewerId === data.reviewerId)) {
        return Promise.reject(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
      }
      const row: Review = {
        ...data,
        id: `r${String(nextId++)}`,
        isPublished: false,
        createdAt: new Date(),
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    getReviewByBookingAndReviewer(bookingId, reviewerId) {
      return Promise.resolve(
        rows.find((r) => r.bookingId === bookingId && r.reviewerId === reviewerId) ?? null,
      );
    },
    countReviewsForBooking(bookingId) {
      return Promise.resolve(rows.filter((r) => r.bookingId === bookingId).length);
    },
    markReviewsPublished(bookingId) {
      const blind = rows.filter((r) => r.bookingId === bookingId && !r.isPublished);
      for (const r of blind) r.isPublished = true;
      return Promise.resolve(blind.map((r) => r.revieweeId));
    },
    publishUnreleasedBefore(cutoff) {
      const stale = rows.filter((r) => !r.isPublished && r.createdAt <= cutoff);
      for (const r of stale) r.isPublished = true;
      return Promise.resolve(stale.map((r) => r.revieweeId));
    },
    recentPublishedFor(revieweeId, limit) {
      return Promise.resolve(
        rows
          .filter((r) => r.revieweeId === revieweeId && r.isPublished)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit),
      );
    },
    listForAdmin(_filter: AdminReviewFilter, limit) {
      return Promise.resolve(rows.slice(0, limit));
    },
    deleteById(id) {
      const at = rows.findIndex((r) => r.id === id);
      if (at === -1) return Promise.resolve(false);
      rows.splice(at, 1);
      return Promise.resolve(true);
    },
    toggleFlag(id) {
      const row = rows.find((r) => r.id === id);
      if (row === undefined) return Promise.resolve(null);
      row.adminFlagged = !row.adminFlagged;
      return Promise.resolve(row.adminFlagged);
    },
  };
  return { repo, rows };
}

function fakeSettings(hours = WINDOW_HOURS): SettingsPublicContract {
  return {
    snapshot: () => Promise.reject(new Error('not used')),
    get: ((_key: string) => Promise.resolve(hours)) as SettingsPublicContract['get'],
  };
}

function fakeRatings() {
  const written: { role: string; id: string; average: number; count: number }[] = [];
  const ratings: RatingCacheContract = {
    setRating(role, id, average, count) {
      written.push({ role, id, average, count });
      return Promise.resolve();
    },
  };
  return { ratings, written };
}

function completedBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: BOOKING,
    customerId: CUSTOMER,
    driverId: DRIVER,
    status: 'COMPLETED',
    completedAt: new Date(),
    ...overrides,
  } as Booking;
}

function fakeBookings(booking: Booking | null): BookingReviewContract {
  return { findById: () => Promise.resolve(booking) };
}

function buildRate(booking: Booking | null, seed: Review[] = [], hours = WINDOW_HOURS) {
  const { repo, rows } = fakeRepo(seed);
  const { ratings, written } = fakeRatings();
  const settings = fakeSettings(hours);
  const publish = new PublishReviewsUseCase(repo, ratings, settings);
  const useCase = new RateTripUseCase(repo, fakeBookings(booking), settings, publish);
  return { useCase, repo, rows, written, publish };
}

const FIVE_STARS = { rating: 5, tags: [] };

describe('Reviews', () => {
  describe('RateTripUseCase', () => {
    it('derives the reviewee from the booking rather than the request', async () => {
      const { useCase, rows } = buildRate(completedBooking());

      await useCase.execute(BOOKING, CUSTOMER, 'CUSTOMER', FIVE_STARS);

      expect(rows[0]).toMatchObject({ revieweeId: DRIVER, revieweeRole: 'DRIVER' });
    });

    it('writes the review blind, so one side rating cannot move an average', async () => {
      const { useCase, rows, written } = buildRate(completedBooking());

      await useCase.execute(BOOKING, CUSTOMER, 'CUSTOMER', FIVE_STARS);

      expect(rows[0]?.isPublished).toBe(false);
      expect(written).toEqual([]);
    });

    it('flags a 2-star review for ops and leaves a 3-star alone', async () => {
      const low = buildRate(completedBooking());
      await low.useCase.execute(BOOKING, CUSTOMER, 'CUSTOMER', { rating: 2, tags: [] });
      expect(low.rows[0]?.adminFlagged).toBe(true);

      const fine = buildRate(completedBooking());
      await fine.useCase.execute(BOOKING, CUSTOMER, 'CUSTOMER', { rating: 3, tags: [] });
      expect(fine.rows[0]?.adminFlagged).toBe(false);
    });

    it('refuses a trip that is not COMPLETED', async () => {
      const { useCase } = buildRate(completedBooking({ status: 'STARTED' }));

      await expect(useCase.execute(BOOKING, CUSTOMER, 'CUSTOMER', FIVE_STARS)).rejects.toMatchObject(
        { statusCode: 403 },
      );
    });

    it('refuses somebody who was not on the trip', async () => {
      const { useCase } = buildRate(completedBooking());

      await expect(
        useCase.execute(BOOKING, 'c00000000000000000000009', 'CUSTOMER', FIVE_STARS),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    /** The customer must not be able to rate as though they were the driver, or vice versa. */
    it('refuses the customer submitting on the driver route', async () => {
      const { useCase } = buildRate(completedBooking());

      await expect(useCase.execute(BOOKING, CUSTOMER, 'DRIVER', FIVE_STARS)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('refuses once the submission window has closed', async () => {
      const stale = completedBooking({
        completedAt: new Date(Date.now() - (WINDOW_HOURS + 1) * 60 * 60 * 1000),
      });
      const { useCase } = buildRate(stale);

      await expect(useCase.execute(BOOKING, CUSTOMER, 'CUSTOMER', FIVE_STARS)).rejects.toMatchObject(
        { statusCode: 403 },
      );
    });

    it('accepts a rating just inside the window', async () => {
      const fresh = completedBooking({
        completedAt: new Date(Date.now() - (WINDOW_HOURS - 1) * 60 * 60 * 1000),
      });
      const { useCase, rows } = buildRate(fresh);

      await useCase.execute(BOOKING, CUSTOMER, 'CUSTOMER', FIVE_STARS);
      expect(rows).toHaveLength(1);
    });

    it('404s on a booking that does not exist', async () => {
      const { useCase } = buildRate(null);

      await expect(useCase.execute(BOOKING, CUSTOMER, 'CUSTOMER', FIVE_STARS)).rejects.toMatchObject(
        { statusCode: 404 },
      );
    });

    it('409s on a second rating from the same person', async () => {
      const { useCase } = buildRate(completedBooking());
      await useCase.execute(BOOKING, CUSTOMER, 'CUSTOMER', FIVE_STARS);

      await expect(useCase.execute(BOOKING, CUSTOMER, 'CUSTOMER', FIVE_STARS)).rejects.toMatchObject(
        { statusCode: 409 },
      );
    });

    /**
     * The read-then-write above is racy: two double-tapped requests both read "not yet rated".
     * Only the unique index actually stops the second, so the duplicate-key error must surface as
     * the same 409 rather than a 500.
     */
    it('turns the unique index into a 409 when the pre-check missed', async () => {
      const existing: Review = {
        id: 'r0',
        bookingId: BOOKING,
        reviewerId: CUSTOMER,
        reviewerRole: 'CUSTOMER',
        revieweeId: DRIVER,
        revieweeRole: 'DRIVER',
        rating: 5,
        tags: [],
        comment: null,
        isPublished: false,
        adminFlagged: false,
        createdAt: new Date(),
      };
      const { repo } = fakeRepo([existing]);
      const { ratings } = fakeRatings();
      const settings = fakeSettings();
      // A repo whose pre-check reports nothing, so only the index catches the duplicate.
      const blind: ReviewRepositoryPort = {
        ...repo,
        getReviewByBookingAndReviewer: () => Promise.resolve(null),
      };
      const useCase = new RateTripUseCase(
        blind,
        fakeBookings(completedBooking()),
        settings,
        new PublishReviewsUseCase(blind, ratings, settings),
      );

      await expect(useCase.execute(BOOKING, CUSTOMER, 'CUSTOMER', FIVE_STARS)).rejects.toMatchObject(
        { statusCode: 409 },
      );
    });

    it('publishes both sides and rescores both people once the second review lands', async () => {
      const { useCase, rows, written } = buildRate(completedBooking());

      await useCase.execute(BOOKING, CUSTOMER, 'CUSTOMER', { rating: 4, tags: [] });
      await useCase.execute(BOOKING, DRIVER, 'DRIVER', { rating: 3, tags: [] });

      expect(rows.every((r) => r.isPublished)).toBe(true);
      expect(written).toEqual(
        expect.arrayContaining([
          { role: 'DRIVER', id: DRIVER, average: 4, count: 1 },
          { role: 'CUSTOMER', id: CUSTOMER, average: 3, count: 1 },
        ]),
      );
    });
  });

  describe('PublishReviewsUseCase', () => {
    const blindReview = (overrides: Partial<Review>): Review => ({
      id: 'r1',
      bookingId: BOOKING,
      reviewerId: CUSTOMER,
      reviewerRole: 'CUSTOMER',
      revieweeId: DRIVER,
      revieweeRole: 'DRIVER',
      rating: 5,
      tags: [],
      comment: null,
      isPublished: false,
      adminFlagged: false,
      createdAt: new Date(),
      ...overrides,
    });

    it('leaves a review inside the window blind', async () => {
      const { repo, rows } = fakeRepo([blindReview({})]);
      const { ratings, written } = fakeRatings();

      const published = await new PublishReviewsUseCase(repo, ratings, fakeSettings()).publishExpired();

      expect(published).toBe(0);
      expect(rows[0]?.isPublished).toBe(false);
      expect(written).toEqual([]);
    });

    it('releases a review whose window has elapsed and rescores the reviewee', async () => {
      const old = blindReview({
        createdAt: new Date(Date.now() - (WINDOW_HOURS + 1) * 60 * 60 * 1000),
      });
      const { repo, rows } = fakeRepo([old]);
      const { ratings, written } = fakeRatings();

      const published = await new PublishReviewsUseCase(repo, ratings, fakeSettings()).publishExpired();

      expect(published).toBe(1);
      expect(rows[0]?.isPublished).toBe(true);
      expect(written).toEqual([{ role: 'DRIVER', id: DRIVER, average: 5, count: 1 }]);
    });

    /** One reviewee with two expired reviews is rescored once, not twice. */
    it('rescores each reviewee a single time per sweep', async () => {
      const long_ago = new Date(Date.now() - (WINDOW_HOURS + 1) * 60 * 60 * 1000);
      const { repo } = fakeRepo([
        blindReview({ id: 'r1', bookingId: 'b1', rating: 5, createdAt: long_ago }),
        blindReview({ id: 'r2', bookingId: 'b2', rating: 3, createdAt: long_ago }),
      ]);
      const { ratings, written } = fakeRatings();

      await new PublishReviewsUseCase(repo, ratings, fakeSettings()).publishExpired();

      expect(written).toEqual([{ role: 'DRIVER', id: DRIVER, average: 4, count: 2 }]);
    });

    it('reads the window on every sweep, so shortening it takes effect without a deploy', async () => {
      const twoHoursOld = blindReview({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
      const { repo } = fakeRepo([twoHoursOld]);
      const { ratings } = fakeRatings();

      expect(await new PublishReviewsUseCase(repo, ratings, fakeSettings(24)).publishExpired()).toBe(0);
      expect(await new PublishReviewsUseCase(repo, ratings, fakeSettings(1)).publishExpired()).toBe(1);
    });
  });
});

/** Guards the assumption every `toMatchObject({ statusCode })` above rests on. */
it('AppError carries the status code these tests assert on', () => {
  expect(AppError.forbidden()).toMatchObject({ statusCode: 403 });
  expect(AppError.notFound()).toMatchObject({ statusCode: 404 });
  expect(AppError.conflict('x')).toMatchObject({ statusCode: 409 });
});
