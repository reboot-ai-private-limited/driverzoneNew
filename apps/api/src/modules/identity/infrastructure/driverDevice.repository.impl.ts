import mongoose from 'mongoose';
import type { DriverDeviceRepositoryPort } from '../domain/driverDevice.repository.port.js';
import { DriverModel } from './driver.model.js';

/**
 * INFRASTRUCTURE — FCM tokens, stored on the driver document.
 *
 * An array field rather than its own collection: a driver has one or two handsets, the tokens are
 * read only on the dispatch path (which already has the driver), and a join to fetch two strings
 * would be work for nothing. `docs/LLD/driver-app.md` S-16.2 sketches a `driverDevices`
 * collection for when devices grow metadata — app version, last seen, platform — and this port is
 * what makes that swap a one-file change.
 */
export class MongoDriverDeviceRepository implements DriverDeviceRepositoryPort {
  async register(driverId: string, fcmToken: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(driverId)) return;

    // `$addToSet`, not `$push`: FCM returns the same token on every launch, so re-registering is
    // the normal case and must not accumulate duplicates that then get rung twice.
    await DriverModel.findByIdAndUpdate(driverId, { $addToSet: { fcmTokens: fcmToken } })
      .lean()
      .exec();
  }

  async tokensFor(driverId: string): Promise<string[]> {
    if (!mongoose.Types.ObjectId.isValid(driverId)) return [];

    const doc = await DriverModel.findById(driverId).select('fcmTokens').lean().exec();
    return (doc as { fcmTokens?: string[] } | null)?.fcmTokens ?? [];
  }

  async remove(fcmToken: string): Promise<void> {
    // Across ALL drivers: a handset that was handed to another driver leaves the same dead token
    // on both records, and both are equally unreachable.
    await DriverModel.updateMany({ fcmTokens: fcmToken }, { $pull: { fcmTokens: fcmToken } })
      .lean()
      .exec();
  }

  async removeForDriver(driverId: string, fcmToken: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(driverId)) return;

    await DriverModel.findByIdAndUpdate(driverId, { $pull: { fcmTokens: fcmToken } })
      .lean()
      .exec();
  }
}
