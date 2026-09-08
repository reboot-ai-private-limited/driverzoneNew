import mongoose from 'mongoose';
import type { CustomerDeviceRepositoryPort } from '../domain/customerDevice.repository.port.js';
import { CustomerModel } from './customer.model.js';

/**
 * INFRASTRUCTURE — FCM tokens on the customer document. Mirrors
 * `MongoDriverDeviceRepository` — same `$addToSet` / `$pull` shape, same reasons.
 */
export class MongoCustomerDeviceRepository implements CustomerDeviceRepositoryPort {
  async register(customerId: string, fcmToken: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(customerId)) return;

    // `$addToSet`, not `$push`: FCM returns the same token on every launch, so re-registering is
    // the normal case and must not accumulate duplicates that then get notified twice.
    await CustomerModel.findByIdAndUpdate(customerId, { $addToSet: { fcmTokens: fcmToken } })
      .lean()
      .exec();
  }

  async tokensFor(customerId: string): Promise<string[]> {
    if (!mongoose.Types.ObjectId.isValid(customerId)) return [];

    const doc = await CustomerModel.findById(customerId).select('fcmTokens').lean().exec();
    return (doc as { fcmTokens?: string[] } | null)?.fcmTokens ?? [];
  }

  async remove(fcmToken: string): Promise<void> {
    // Across ALL customers: a handset handed to someone else leaves the same dead token on both
    // records, and both are equally unreachable.
    await CustomerModel.updateMany({ fcmTokens: fcmToken }, { $pull: { fcmTokens: fcmToken } })
      .lean()
      .exec();
  }

  async removeForCustomer(customerId: string, fcmToken: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(customerId)) return;

    await CustomerModel.findByIdAndUpdate(customerId, { $pull: { fcmTokens: fcmToken } })
      .lean()
      .exec();
  }
}
