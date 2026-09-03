import mongoose from 'mongoose';
import type { DriverCandidate } from '../domain/offer.entity.js';
import type { DriverPoolPort, DriverPoolQuery } from '../domain/ports.js';

/**
 * INFRASTRUCTURE — eligible drivers, from Mongo's own geospatial index.
 *
 * `docs/LLD/architecture.md` intends this to be a Redis `GEOSEARCH` over live positions, with
 * Mongo filtering only the shortlist it returns. That is the right shape at volume — but the
 * location ping path that would keep Redis populated does not exist yet, so `drivers.lastLocation`
 * is the only position data there is. The port is what makes that swap a one-file change.
 *
 * `$geoNear` must be the FIRST stage of an aggregation and there can only be one, which is why
 * this is a pipeline rather than a `find`.
 */

/** A position older than this is not evidence of where a driver is now. */
const MAX_POSITION_AGE_MS = 2 * 60_000;

interface DriverRow {
  _id: mongoose.Types.ObjectId;
  distanceMetres: number;
  acceptanceRate?: number | null;
  rating?: number | null;
  lastTripEndedAt?: Date | null;
}

export class MongoDriverPool implements DriverPoolPort {
  async findEligible(query: DriverPoolQuery): Promise<DriverCandidate[]> {
    const model = mongoose.models['Driver'];
    if (model === undefined) return [];

    const excluded = query.excludeDriverIds
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const match: Record<string, unknown> = {
      isOnDuty: true,
      isVerified: true,
      isBlocked: { $ne: true },
      lastLocationAt: { $gt: new Date(query.now.getTime() - MAX_POSITION_AGE_MS) },
      /*
       * A driver holding more of the company's cash than we allow stops being offered work. The
       * debt is only ever collected out of future earnings, so letting it grow is how it becomes
       * uncollectable.
       */
      walletBalancePaise: { $gte: -query.maxNegativeBalancePaise },
    };

    if (excluded.length > 0) match['_id'] = { $nin: excluded };

    /*
     * `canDriveHillVerified`, NOT `canDriveHill`.
     *
     * The two disagree in the docs — the eligibility query in dispatch-and-assignment.md checks
     * the self-declared flag while the schema comment says hill dispatch checks the verified one.
     * The verified flag wins: an unverified self-declaration is not a reason to put someone on a
     * mountain road at night.
     */
    if (query.requireHillVerified) match['canDriveHillVerified'] = true;

    /*
     * THE COMPETENCY GATE — the `dcc.car_category_id = $carCategory` join in
     * docs/LLD/dispatch-and-assignment.md, finally wired up.
     *
     * EXACT MATCH ON BOTH, and no fallback. A driver who has not declared the category is not
     * quietly treated as able to drive it: `$eq` against an array field matches when the array
     * CONTAINS the value, so an empty preference matches nothing and that driver is simply not
     * offered the trip. That is the intended reading of an unset preference — the alternative,
     * "unset means anything", sends an SUV to whoever happens to be nearest.
     *
     * Skipped entirely when the booking states no requirement, which only happens on rows written
     * before 2026-09-02. Those keep dispatching exactly as they did.
     */
    if (query.carCategory !== null) match['vehicleCategoryPreference'] = query.carCategory;
    if (query.vehicleType !== null) match['vehicleTypePreferences'] = query.vehicleType;

    const rows = await model.aggregate<DriverRow>([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [query.pickup.lng, query.pickup.lat] },
          distanceField: 'distanceMetres',
          maxDistance: query.radiusMetres,
          key: 'lastLocation',
          query: match,
          spherical: true,
        },
      },
      // Bounded so a dense city centre cannot return thousands of rows to rank in memory. The
      // wave only ever needs the top handful, and $geoNear already returns nearest-first.
      { $limit: 50 },
      {
        $project: {
          distanceMetres: 1,
          acceptanceRate: 1,
          rating: 1,
          lastTripEndedAt: 1,
        },
      },
    ]);

    return rows.map((row) => ({
      driverId: String(row._id),
      distanceMetres: Math.round(row.distanceMetres),
      acceptanceRate: row.acceptanceRate ?? null,
      rating: row.rating ?? null,
      idleMinutes:
        row.lastTripEndedAt == null
          ? 60
          : Math.floor((query.now.getTime() - row.lastTripEndedAt.getTime()) / 60_000),
    }));
  }
}
