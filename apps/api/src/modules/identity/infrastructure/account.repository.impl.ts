import type { Role } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import type { Account, AccountRepositoryPort } from '../domain/account.repository.port.js';
import { AdminUserModel } from './adminUser.model.js';
import { CustomerModel } from './customer.model.js';
import { DriverModel } from './driver.model.js';

/**
 * INFRASTRUCTURE — the port, over three collections.
 *
 * The role switch lives here rather than in the use case on purpose: which collection backs a
 * role is a storage fact, and the auth flow works identically across all three. Push it up into
 * `application/` and every use case grows a switch it has no reason to own.
 */
export class MongoAccountRepository implements AccountRepositoryPort {
  async findByPhone(role: Role, phone: string): Promise<Account | undefined> {
    if (role === 'ADMIN') {
      // For Admin, isActive: true means not blocked. However, since we return undefined
      // if not found or inactive, an admin account returned from here is always not blocked.
      const admin = await AdminUserModel.findOne({ phone, isActive: true }).lean().exec();
      return admin === null
        ? undefined
        : {
            id: String(admin._id),
            mobileNumber: admin.phone,
            fullName: admin.fullName,
            isBlocked: false
          };
    }

    /**
     * Branched rather than `const model = cond ? CustomerModel : DriverModel`.
     *
     * A union of two Mongoose `Model<T>` types has overloaded call signatures that TypeScript
     * cannot reconcile, so calling `.findOne` on the union is an error even though both members
     * accept the identical argument. Two statements, no casts.
     */
    const doc =
      role === 'CUSTOMER'
        ? await CustomerModel.findOne({ phone }).lean().exec()
        : await DriverModel.findOne({ phone }).lean().exec();

    return doc === null
      ? undefined
      : {
          id: String(doc._id),
          mobileNumber: doc.phone,
          fullName: doc.fullName ?? null,
          isBlocked: doc.isBlocked ?? false
        };
  }

  async create(role: Role, phone: string): Promise<Account> {
    /**
     * The last line of defence on admin provisioning.
     *
     * `verifyOtp` already refuses to reach this for `ADMIN`, and `sendOtp` never stores a
     * challenge for an unprovisioned admin number — so this is the third independent guard on
     * the same rule. Deliberate: "creating an administrator" is not a mistake worth leaving one
     * refactor away from being possible.
     */
    if (role === 'ADMIN') {
      throw AppError.internal('INTERNAL', { reason: 'admin accounts are provisioned out of band' });
    }

    // Branched for the same reason as `findByPhone` above.
    const created =
      role === 'CUSTOMER'
        ? await CustomerModel.create({ phone })
        : await DriverModel.create({ phone });

    return { id: String(created._id), mobileNumber: created.phone, fullName: null, isBlocked: false };
  }
}
