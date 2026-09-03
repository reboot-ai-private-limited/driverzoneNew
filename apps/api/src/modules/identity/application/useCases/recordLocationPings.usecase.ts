import { AppError } from '@/shared/errors/AppError.js';
import type { DriverProfileRepositoryPort } from '../../domain/driverProfile.repository.port.js';

export interface LocationPing {
  lat: number;
  lng: number;
  recordedAt: Date;
}

export interface RecordLocationPingsResult {
  accepted: number;
  isOnDuty: boolean;
}

/**
 * APPLICATION — where a driver is.
 *
 * `MongoDriverPool` runs `$geoNear` against `lastLocation` and drops anything whose
 * `lastLocationAt` is older than two minutes, so this is not telemetry: it is the thing that
 * makes a driver dispatchable at all. A driver on duty who stops pinging silently leaves the
 * pool, which is the intended behaviour — a phone that stopped reporting is not evidence of
 * where anyone is.
 *
 * **Only the newest fix is stored.** The batch exists to save the driver's battery and data, not
 * because history is wanted here — `drivers.lastLocation` is a single current position, and the
 * trip trace that does want history belongs to `bookings`. Taking the newest by `recordedAt`
 * rather than by array position means an out-of-order flush after a reconnect cannot move a
 * driver backwards.
 */
export class RecordLocationPingsUseCase {
  constructor(private readonly drivers: DriverProfileRepositoryPort) {}

  async execute(driverId: string, pings: LocationPing[]): Promise<RecordLocationPingsResult> {
    if (pings.length === 0) throw AppError.badRequest('No location pings were sent.');

    const newest = pings.reduce((latest, ping) =>
      ping.recordedAt > latest.recordedAt ? ping : latest,
    );

    /*
     * A fix from the future is a broken device clock, and trusting it would pin the driver as
     * "fresh" indefinitely — they would stay in the dispatch pool long after going dark. Clamp to
     * now rather than reject: the position is probably still right, only the timestamp is not.
     */
    const now = new Date();
    const recordedAt = newest.recordedAt > now ? now : newest.recordedAt;

    const updated = await this.drivers.recordLocation(driverId, {
      lat: newest.lat,
      lng: newest.lng,
      recordedAt,
    });
    if (updated === undefined) throw AppError.notFound('Your profile could not be found.');

    return { accepted: pings.length, isOnDuty: updated.isOnDuty };
  }
}
