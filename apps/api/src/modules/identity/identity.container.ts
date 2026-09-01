import { Router } from 'express';
import type { Role } from '@driverzone/contracts';
import { allowDevShortcuts, env, isProduction } from '@/config/env.js';
import { DEV_ACCOUNT_PHONES } from '@/config/devAccounts.js';
import { getRedis } from '@/shared/queue/redis.js';
import { TokenIssuer } from './application/tokenIssuer.js';
import { LogoutUseCase } from './application/useCases/logout.usecase.js';
import { RefreshSessionUseCase } from './application/useCases/refreshSession.usecase.js';
import { SendOtpUseCase } from './application/useCases/sendOtp.usecase.js';
import { VerifyOtpUseCase } from './application/useCases/verifyOtp.usecase.js';
import { GetCustomerProfileUseCase } from './application/useCases/getCustomerProfile.usecase.js';
import { UpdateCustomerProfileUseCase } from './application/useCases/updateCustomerProfile.usecase.js';
import { ManageAddressesUseCase } from './application/useCases/manageAddresses.usecase.js';
import { ManageVehiclesUseCase } from './application/useCases/manageVehicles.usecase.js';
import { UpsertFromBookingUseCase } from './application/useCases/upsertFromBooking.usecase.js';
import { GetDriverProfileUseCase } from './application/useCases/getDriverProfile.usecase.js';
import { UpdateDriverProfileUseCase } from './application/useCases/updateDriverProfile.usecase.js';
import { ManageDriverDocumentsUseCase } from './application/useCases/manageDriverDocuments.usecase.js';
import { RequestProfilePictureUploadUseCase } from './application/useCases/requestProfilePictureUpload.usecase.js';
import { SubmitOnboardingUseCase } from './application/useCases/submitOnboarding.usecase.js';
import { ManageAdminProfileUseCase } from './application/useCases/manageAdminProfile.usecase.js';
import { VerifyDriverUseCase } from './application/useCases/verifyDriver.usecase.js';
import { ListDriversAdminUseCase } from './application/useCases/listDriversAdmin.usecase.js';
import { ListCustomersAdminUseCase } from './application/useCases/listCustomersAdmin.usecase.js';
import { ManageCustomerAdminUseCase } from './application/useCases/manageCustomerAdmin.usecase.js';
import { GetDriverDetailsAdminUseCase } from './application/useCases/getDriverDetailsAdmin.usecase.js';
import { MongoAccountRepository } from './infrastructure/account.repository.impl.js';
import { MongoAccountDirectory } from './infrastructure/accountDirectory.impl.js';
import { MongoSessionRepository } from './infrastructure/session.repository.impl.js';
import { MongoCustomerProfileRepository } from './infrastructure/customerProfile.repository.impl.js';
import { MongoDriverProfileRepository } from './infrastructure/driverProfile.repository.impl.js';
import { MongoDriverDocumentRepository } from './infrastructure/driverDocument.repository.impl.js';
import { MongoAdminProfileRepository } from './infrastructure/adminProfile.repository.impl.js';
import { MongoAuditLog } from './infrastructure/audit.mongo.js';
import { LoggingOtpSender } from './infrastructure/otpSender.log.js';
import { CloudinaryStorage } from '@/shared/storage/cloudinary.storage.js';
import { RedisOtpStore } from './infrastructure/otpStore.redis.js';
import { makeAuthControllers } from './interface/auth.controller.js';
import { buildAuthRouter } from './interface/auth.routes.js';
import { makeCustomerControllers } from './interface/customer.controller.js';
import { buildCustomerRouter } from './interface/customer.routes.js';
import { makeDriverControllers } from './interface/driver.controller.js';
import { buildDriverRouter } from './interface/driver.routes.js';
import { makeAdminControllers } from './interface/admin.controller.js';
import { buildAdminRouter } from './interface/admin.routes.js';
import { registerIdentitySwaggerPaths } from './interface/identity.swagger.js';
import type { IdentityPublicContract } from './identity.public.js';

/**
 * THE COMPOSITION ROOT for this module — the one file allowed to name concrete classes.
 *
 * Two adapters here are development stand-ins, and both refuse to run in production rather than
 * degrading quietly: `LoggingOtpSender` (no SMS provider exists) and `StubDocumentStorage` (no
 * object storage exists). Replacing either is one line in this file and nothing else — no use
 * case, port or test changes. That is the entire return on typing everything above against
 * ports.
 */
export interface IdentityContainer {
  contract: IdentityPublicContract;

  /**
   * Builds one role's complete surface: `/auth/*` plus that role's own routes.
   *
   * A function rather than an eager property, so the worker — which builds every container and
   * serves no HTTP — allocates no routers (docs/decision-log.md, 2026-08-22). Composing per role
   * here rather than in `routes.ts` keeps the mount list at three entries as endpoints grow.
   */
  buildRoleRouter: (role: Role) => Router;
}

export function buildIdentityContainer(): IdentityContainer {
  registerIdentitySwaggerPaths();

  // Redis is shared with BullMQ rather than opening a second connection: it is already
  // configured with `maxRetriesPerRequest: null` and multiplexes fine at these command volumes.
  const otpStore = new RedisOtpStore(getRedis());
  const otpSender = new LoggingOtpSender();
  const documentStorage = new CloudinaryStorage({
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
  });

  const accounts = new MongoAccountRepository();
  const sessions = new MongoSessionRepository();
  const customers = new MongoCustomerProfileRepository();
  const drivers = new MongoDriverProfileRepository();
  const documents = new MongoDriverDocumentRepository();
  const admins = new MongoAdminProfileRepository();
  const audit = new MongoAuditLog();

  const tokenIssuer = new TokenIssuer(sessions);

  // The pepper is read here rather than inside the entity that uses it, which keeps
  // `otpChallenge.entity.ts` a pure function of its arguments and testable with no environment.
  /**
   * THE one line that decides whether a login bypass exists at all.
   *
   * Still one expression, and still here rather than inside the use case: the use case cannot
   * switch itself on, so "can this happen in production" is answerable by reading this
   * expression instead of auditing a branch buried in application logic. `loadEnv()` is the
   * second lock — it refuses to start a production process that has `DEV_FIXED_OTP` set without
   * `STAGING_UNSAFE` alongside it, and shouts on every boot when it does.
   *
   * `allowDevShortcuts` is the staging escape hatch (config/env.ts). It does not weaken the
   * other half: an unseeded number takes the ordinary path here as it always has.
   */
  const devBypass =
    (!isProduction || allowDevShortcuts) && env.DEV_FIXED_OTP !== undefined
      ? { code: env.DEV_FIXED_OTP, phones: DEV_ACCOUNT_PHONES }
      : undefined;

  const sendOtp = new SendOtpUseCase(otpStore, otpSender, accounts, env.OTP_PEPPER);
  const verifyOtp = new VerifyOtpUseCase(otpStore, accounts, tokenIssuer, env.OTP_PEPPER, devBypass);
  const refreshSession = new RefreshSessionUseCase(sessions, tokenIssuer);
  const logout = new LogoutUseCase(sessions);

  const getCustomerProfile = new GetCustomerProfileUseCase(customers);
  const updateCustomerProfile = new UpdateCustomerProfileUseCase(customers);
  const manageAddresses = new ManageAddressesUseCase(customers);
  const manageVehicles = new ManageVehiclesUseCase(customers);
  const upsertFromBooking = new UpsertFromBookingUseCase(customers);

  const getDriverProfile = new GetDriverProfileUseCase(drivers);
  const updateDriverProfile = new UpdateDriverProfileUseCase(drivers);
  const requestProfilePictureUpload = new RequestProfilePictureUploadUseCase(
    documentStorage,
    env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
    env.UPLOAD_ALLOWED_FORMATS
  );
  const manageDocuments = new ManageDriverDocumentsUseCase(
    documents,
    documentStorage,
    env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
    env.UPLOAD_ALLOWED_FORMATS
  );
  const submitOnboarding = new SubmitOnboardingUseCase(drivers, documents);

  const adminProfile = new ManageAdminProfileUseCase(admins);
  const verifyDriver = new VerifyDriverUseCase(drivers, documents, audit);
  // Same repository the customer's own profile routes use, a different use case in front of it.
  // The narrow, self-only use cases stay exactly as they are — widening one of them to accept a
  // customer id is how an admin-shaped hole appears in the customer app's surface.
  const listCustomersAdmin = new ListCustomersAdminUseCase(customers);
  const manageCustomerAdmin = new ManageCustomerAdminUseCase(customers, audit);

  const listDriversAdmin = new ListDriversAdminUseCase(drivers);
  const getDriverDetailsAdmin = new GetDriverDetailsAdminUseCase(drivers, documents, documentStorage);

  const authRouterFor = (role: Role): Router =>
    buildAuthRouter(role, makeAuthControllers(role, { sendOtp, verifyOtp, refreshSession, logout }));

  const ownRouterFor = (role: Role): Router => {
    if (role === 'CUSTOMER') {
      return buildCustomerRouter(
        makeCustomerControllers({
          getProfile: getCustomerProfile,
          updateProfile: updateCustomerProfile,
          addresses: manageAddresses,
          vehicles: manageVehicles,
        }),
      );
    }
    if (role === 'DRIVER') {
      return buildDriverRouter(
        makeDriverControllers({
          getProfile: getDriverProfile,
          updateProfile: updateDriverProfile,
          requestProfilePictureUpload,
          documents: manageDocuments,
          submitOnboarding,
        }),
      );
    }
    return buildAdminRouter(makeAdminControllers({
      profile: adminProfile,
      verifyDriver,
      listDrivers: listDriversAdmin,
      getDriverDetails: getDriverDetailsAdmin,
      listCustomers: listCustomersAdmin,
      manageCustomer: manageCustomerAdmin
    }));
  };

  // Backs the read-side and rating-cache halves of the public contract. Stateless, so it is
  // constructed here beside the repositories rather than threaded through a use case.
  const directory = new MongoAccountDirectory();

  return {
    contract: {
      // The read side and the rating cache. Consumed by `reviews`, which renders names in the
      // admin ledger and writes back the rolling average it computes.
      namesByIds: (role, ids) => directory.namesByIds(role, ids),
      setRating: (role, id, average, count) => directory.setRating(role, id, average, count),

      // The write-side surface `bookings` (tier 6) consumes when POST /bookings carries
      // `save_pickup_address` or `save_vehicle`.
      upsertAddressFromBooking: (customerId, address) =>
        upsertFromBooking.upsertAddress(customerId, {
          label: address.label,
          address: address.address,
          lat: address.lat,
          lng: address.lng,
          isPreferredPickup: address.isPreferredPickup,
        }),
      upsertVehicleFromBooking: (customerId, vehicle) =>
        upsertFromBooking.upsertVehicle(customerId, {
          category: vehicle.category,
          plateNumber: vehicle.plateNumber,
          fuelType: vehicle.fuelType,
        }),
    },

    buildRoleRouter: (role: Role) => {
      const router = Router();
      // Auth first: it is the only unauthenticated part of a role's surface, and mounting it
      // ahead of the guarded routes keeps the two clearly separated.
      router.use('/auth', authRouterFor(role));
      router.use('/', ownRouterFor(role));
      return router;
    },
  };
}
