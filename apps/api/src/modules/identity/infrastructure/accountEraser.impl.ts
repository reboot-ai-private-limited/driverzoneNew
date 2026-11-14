import mongoose from 'mongoose';
import type { AccountEraserPort, ErasedAccount } from '../domain/accountEraser.port.js';
import { CustomerModel } from './customer.model.js';
import { DriverModel } from './driver.model.js';
import { DriverDocumentModel } from './driverDocument.model.js';

/** What `phone` becomes. Unique per row, so the unique index on `phone` still holds. */
function tombstonePhone(id: string): string {
  return `deleted:${id}`;
}

/**
 * INFRASTRUCTURE — see `AccountEraserPort` for what is erased and why the row is kept.
 *
 * `isBlocked: true` is belt and braces: with the phone replaced nobody can sign in to this row
 * anyway, but every query that already excludes blocked accounts (the dispatch pool, manual
 * assignment) then excludes a deleted one without needing to learn about `deletedAt`.
 */
export class MongoAccountEraser implements AccountEraserPort {
  async eraseCustomer(customerId: string, at: Date): Promise<ErasedAccount | undefined> {
    if (!mongoose.isValidObjectId(customerId)) return undefined;

    const before = await CustomerModel.findOneAndUpdate(
      { _id: customerId, deletedAt: null },
      {
        $set: {
          phone: tombstonePhone(customerId),
          fullName: null,
          dob: null,
          gender: null,
          languagesKnown: [],
          alternatePhone: null,
          emergencyContact: null,
          whatsappMarketingOptIn: false,
          whatsappMarketingConsentAt: null,
          savedAddresses: [],
          vehicles: [],
          fcmTokens: [],
          isBlocked: true,
          deletedAt: at,
        },
      },
    )
      .lean()
      .exec();

    return before === null ? undefined : { privateFileKeys: [], publicFileKeys: [] };
  }

  async eraseDriver(driverId: string, at: Date): Promise<ErasedAccount | undefined> {
    if (!mongoose.isValidObjectId(driverId)) return undefined;

    // `new: false` — the PREVIOUS row, because the profile photo's key is what we are erasing.
    const before = await DriverModel.findOneAndUpdate(
      { _id: driverId, deletedAt: null },
      {
        $set: {
          phone: tombstonePhone(driverId),
          fullName: null,
          profilePicture: null,
          homeZoneId: null,
          dob: null,
          gender: null,
          experienceYears: null,
          alternatePhone: null,
          emergencyContact: null,
          address: null,
          vehicleTypePreferences: [],
          vehicleCategoryPreference: [],
          lastLocation: null,
          lastLocationAt: null,
          fcmTokens: [],
          isOnDuty: false,
          isVerified: false,
          isBlocked: true,
          blockedReason: 'Account deleted',
          onboardingRejectionReason: null,
          deletedAt: at,
        },
      },
      { new: false },
    )
      .lean()
      .exec();

    if (before === null) return undefined;

    /*
     * The documents go entirely: licence numbers and ID images are the most sensitive thing we
     * hold, and unlike a booking nothing needs them once the person is gone. Read first so the
     * files can be removed from storage after the rows are.
     */
    const documents = await DriverDocumentModel.find({ driverId }).select('fileUrl').lean().exec();
    await DriverDocumentModel.deleteMany({ driverId }).exec();

    return {
      privateFileKeys: documents.map((doc) => doc.fileUrl).filter((key) => key !== ''),
      publicFileKeys:
        before.profilePicture === null || before.profilePicture === undefined
          ? []
          : [before.profilePicture],
    };
  }
}
