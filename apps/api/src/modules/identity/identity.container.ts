import { Router } from 'express';
import type { Role } from '@driverzone/contracts';
import { allowDevShortcuts, env, isProduction } from '@/config/env.js';
import { DEV_ACCOUNT_PHONES } from '@/config/devAccounts.js';
import { getRedis } from '@/shared/queue/redis.js';
import { logger } from '@/shared/logging/logger.js';
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
import { SetDutyStatusUseCase } from './application/useCases/setDutyStatus.usecase.js';
import { RecordLocationPingsUseCase } from './application/useCases/recordLocationPings.usecase.js';
import { ManageAdminProfileUseCase } from './application/useCases/manageAdminProfile.usecase.js';
import { VerifyDriverUseCase } from './application/useCases/verifyDriver.usecase.js';
import { ListDriversAdminUseCase } from './application/useCases/listDriversAdmin.usecase.js';
import { ListCustomersAdminUseCase } from './application/useCases/listCustomersAdmin.usecase.js';
import { ManageCustomerAdminUseCase } from './application/useCases/manageCustomerAdmin.usecase.js';
import { ManageDriverAdminUseCase } from './application/useCases/manageDriverAdmin.usecase.js';
import { GetDriverDetailsAdminUseCase } from './application/useCases/getDriverDetailsAdmin.usecase.js';
import { GetDriverDutyHistoryAdminUseCase } from './application/useCases/getDriverDutyHistoryAdmin.usecase.js';
import { GetLiveDriversAdminUseCase } from './application/useCases/getLiveDriversAdmin.usecase.js';
import { MongoAccountRepository } from './infrastructure/account.repository.impl.js';
import { MongoAccountDirectory } from './infrastructure/accountDirectory.impl.js';
import { MongoSessionRepository } from './infrastructure/session.repository.impl.js';
import { MongoCustomerProfileRepository } from './infrastructure/customerProfile.repository.impl.js';
import { MongoDriverProfileRepository } from './infrastructure/driverProfile.repository.impl.js';
import { MongoDriverDocumentRepository } from './infrastructure/driverDocument.repository.impl.js';
import { MongoCustomerDeviceRepository } from './infrastructure/customerDevice.repository.impl.js';
import { MongoDriverDeviceRepository } from './infrastructure/driverDevice.repository.impl.js';
import { MongoDutySessionRepository } from './infrastructure/dutySession.repository.impl.js';
import { MongoAdminProfileRepository } from './infrastructure/adminProfile.repository.impl.js';
import { MongoAuditLog } from './infrastructure/audit.mongo.js';
import { LoggingOtpSender } from './infrastructure/otpSender.log.js';
import { WhatsAppOtpSender } from './infrastructure/otpSender.whatsapp.js';
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
import type { AssignableDriver, IdentityPublicContract } from './identity.public.js';
import type { DriverProfile } from './domain/driverProfile.repository.port.js';
import type { DriverDeviceRepositoryPort } from './domain/driverDevice.repository.port.js';
import type { CustomerDeviceRepositoryPort } from './domain/customerDevice.repository.port.js';

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

  /**
   * Take on-duty drivers who have stopped reporting their position off duty, and return their ids.
   *
   * On the container rather than in `contract` because the caller is the WORKER's sweeper, not
   * another module — nothing in the tier graph needs this, and putting it on the public contract
   * would invite something to. Same placement as `bookings.sweepAbandonedPayments` for the same
   * reason.
   */
  sweepStalePresence: (cutoff: Date, limit: number) => Promise<string[]>;

  /**
   * The device registries, handed to `notifications` by the composition root.
   *
   * On the container rather than in `contract` for the same reason as `sweepStalePresence`: these
   * are not something a module asks identity to *do*. They are ports identity implements and one
   * specific consumer needs, and `container.ts` is where that wiring belongs — `notifications`
   * importing the Mongo classes directly is what this exists to stop.
   */
  driverDevices: DriverDeviceRepositoryPort;
  customerDevices: CustomerDeviceRepositoryPort;
}

/** The `AssignableDriver` shape, from a full `DriverProfile` — shared by both lookups below. */
function toAssignableDriver(profile: DriverProfile): AssignableDriver {
  return {
    id: profile.id,
    fullName: profile.fullName,
    phone: profile.mobileNumber,
    isOnDuty: profile.isOnDuty,
    vehicleCategoryPreference: profile.vehicleCategoryPreference,
    vehicleTypePreferences: profile.vehicleTypePreferences,
    canDriveHillVerified: profile.canDriveHillVerified,
  };
}

export function buildIdentityContainer(): IdentityContainer {
  registerIdentitySwaggerPaths();

  // Redis is shared with BullMQ rather than opening a second connection: it is already
  // configured with `maxRetriesPerRequest: null` and multiplexes fine at these command volumes.
  const otpStore = new RedisOtpStore(getRedis());

  /**
   * How the login code is delivered:
   *
   *   - all four WA_* keys set  → WhatsApp, through wabridge (`WhatsAppOtpSender`)
   *   - otherwise               → written to the log (`LoggingOtpSender`)
   *
   * Keyed on the CREDENTIALS being present, not on `NODE_ENV`. Running the whole API as
   * `NODE_ENV=production` just to reach the real sender also trips every other "no mock in
   * production" guard — payments, the Secure refresh cookie, the seed script — which is not what
   * "send OTPs over WhatsApp from my machine" is asking for. A developer who does not want real
   * sends simply leaves a WA_* key unset.
   *
   * `LoggingOtpSender` still refuses to run when `NODE_ENV=production` without `STAGING_UNSAFE`,
   * so a real production deploy that forgot the WA_* keys fails loudly rather than writing login
   * codes to stdout.
   */
  const waConfigured =
    env.WA_APP_KEY !== undefined &&
    env.WA_AUTH_KEY !== undefined &&
    env.WA_DEVICE_ID !== undefined &&
    env.WA_TEMPLATE_ID !== undefined;

  const otpSender = waConfigured
    ? new WhatsAppOtpSender({
        apiUrl: env.WA_API_URL,
        appKey: env.WA_APP_KEY,
        authKey: env.WA_AUTH_KEY,
        deviceId: env.WA_DEVICE_ID,
        templateId: env.WA_TEMPLATE_ID,
        contactNumber: env.WA_OTP_CONTACT_NUMBER,
      })
    : new LoggingOtpSender();

  logger.info(
    { channel: waConfigured ? 'whatsapp' : 'log' },
    'identity: login OTP delivery channel',
  );
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
  const dutySessions = new MongoDutySessionRepository();
  const submitOnboarding = new SubmitOnboardingUseCase(drivers, documents);
  const setDuty = new SetDutyStatusUseCase(drivers, dutySessions);
  const recordLocation = new RecordLocationPingsUseCase(drivers);
  const devices = new MongoDriverDeviceRepository();
  const customerDevices = new MongoCustomerDeviceRepository();

  const adminProfile = new ManageAdminProfileUseCase(admins);
  const verifyDriver = new VerifyDriverUseCase(drivers, documents, audit, dutySessions);
  // Same repository the customer's own profile routes use, a different use case in front of it.
  // The narrow, self-only use cases stay exactly as they are — widening one of them to accept a
  // customer id is how an admin-shaped hole appears in the customer app's surface.
  const listCustomersAdmin = new ListCustomersAdminUseCase(customers);
  const manageCustomerAdmin = new ManageCustomerAdminUseCase(customers, audit);

  const listDriversAdmin = new ListDriversAdminUseCase(drivers, documents, documentStorage);
  const getDriverDetailsAdmin = new GetDriverDetailsAdminUseCase(drivers, documents, documentStorage);
  const manageDriverAdmin = new ManageDriverAdminUseCase(drivers, audit);
  const getDriverDutyHistoryAdmin = new GetDriverDutyHistoryAdminUseCase(dutySessions);
  const getLiveDriversAdmin = new GetLiveDriversAdminUseCase(drivers);

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
          devices: customerDevices,
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
          setDuty,
          recordLocation,
          devices,
        }),
      );
    }
    return buildAdminRouter(makeAdminControllers({
      profile: adminProfile,
      verifyDriver,
      listDrivers: listDriversAdmin,
      getLiveDrivers: getLiveDriversAdmin,
      getDriverDetails: getDriverDetailsAdmin,
      manageDriver: manageDriverAdmin,
      getDriverDutyHistory: getDriverDutyHistoryAdmin,
      listCustomers: listCustomersAdmin,
      manageCustomer: manageCustomerAdmin
    }));
  };

  // Backs the read-side and rating-cache halves of the public contract. Stateless, so it is
  // constructed here beside the repositories rather than threaded through a use case.
  // `documentStorage` for the avatar's public URL: same provider, and an avatar is the one thing
  // it stores publicly (`isPrivate: false`) rather than presigning per read.
  const directory = new MongoAccountDirectory(documentStorage);

  return {
    // The worker's presence sweep. See the note on `IdentityContainer` for why it sits here and
    // not on the public contract.
    sweepStalePresence: (cutoff, limit) => drivers.sweepStalePresence(cutoff, limit),

    // The same two instances the routes above register handsets into — not new ones. `container.ts`
    // hands these to `notifications`, which is the only other module that needs them.
    driverDevices: devices,
    customerDevices,

    contract: {
      // The read side and the rating cache. Consumed by `reviews`, which renders names in the
      // admin ledger and writes back the rolling average it computes.
      namesByIds: (role, ids) => directory.namesByIds(role, ids),

      // Turns a search box's words into account ids, so a caller can filter its OWN rows by
      // them. `bookings` is the first consumer: the admin booking table searches by customer and
      // driver name, and cannot read this module's collections to do it.
      idsMatching: (role, search, limit) => directory.idsMatching(role, search, limit),

      setRating: (role, id, average, count) => directory.setRating(role, id, average, count),
      recordCompletedRide: (driverId, completedAt) => directory.recordCompletedRide(driverId, completedAt),

      // The driver card a customer sees on their trip. `bookings` decides whether the phone
      // number on it is passed on — see `DriverCardContract`.
      driverCardsByIds: (ids) => directory.driverCardsByIds(ids),

      /*
       * The manual-assignment picker, for `dispatch`. Reuses the admin list's own paginated query
       * rather than adding a second driver search — one place decides what `search` matches.
       *
       * `isVerified: true` is in the filter; blocked is rejected here because `DriverListFilter`
       * has no field for it. On duty is neither — see `AssignableDriversContract` on why an admin
       * is allowed to override that one and the server does not.
       */
      assignableDrivers: async (search, limit) => {
        const { drivers: found } = await drivers.findPaginated(
          { isVerified: true, ...(search === '' ? {} : { search }) },
          1,
          limit,
        );

        return found.filter((profile) => !profile.isBlocked).map(toAssignableDriver);
      },

      /*
       * Looked up directly rather than through `assignableDrivers` above — `search` there is a
       * name/phone regex, and an id is never a substring of either, so this is the ONLY correct
       * way to ask "is this specific driver assignable". See `AssignableDriversContract`.
       */
      assignableDriverById: async (id) => {
        const profile = await drivers.findById(id);
        if (profile === undefined || !profile.isVerified || profile.isBlocked) return null;
        return toAssignableDriver(profile);
      },

      // The mirror: the customer contact the driver sees on their trip. Same rule — `bookings`
      // gates the phone number on the trip being live.
      customerContactsByIds: (ids) => directory.customerContactsByIds(ids),

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
