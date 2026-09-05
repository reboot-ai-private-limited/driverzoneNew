import type { Request, RequestHandler } from 'express';
import type {
  AdminProfileDto,
  AdminCustomerDetailsDto,
  AdminCustomerListDto,
  AdminCustomerListItemDto,
  AdminDriverListDto,
  AdminDriverDetailsDto,
  AdminDriverDutyHistoryDto,
  DriverProfileDto,
  DriverDocumentDto,
  ApproveDriverResponse,
  RejectDriverResponse,
  ReviewDocumentResponse,
  SavedAddressDto,
  VehicleDto,
} from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { ManageAdminProfileUseCase } from '../application/useCases/manageAdminProfile.usecase.js';
import type { VerifyDriverUseCase } from '../application/useCases/verifyDriver.usecase.js';
import type { ListDriversAdminUseCase } from '../application/useCases/listDriversAdmin.usecase.js';
import type { GetDriverDetailsAdminUseCase } from '../application/useCases/getDriverDetailsAdmin.usecase.js';
import type { ListCustomersAdminUseCase } from '../application/useCases/listCustomersAdmin.usecase.js';
import type { ManageCustomerAdminUseCase } from '../application/useCases/manageCustomerAdmin.usecase.js';
import type { DriverProfile } from '../domain/driverProfile.repository.port.js';
import type { DriverDocument } from '../domain/driverDocument.repository.port.js';
import type { SavedAddress, Vehicle } from '../domain/customerProfile.entity.js';
import type { CustomerProfile } from '../domain/customerProfile.repository.port.js';
import {
  rejectDriverSchema,
  reviewDocumentSchema,
  updateAdminProfileSchema,
  adminDriverListQuerySchema,
  driverIdParamSchema,
  adminCustomerListQuerySchema,
  adminUpdateCustomerSchema,
  customerIdParamSchema,
} from './identity.validation.js';

/**
 * INTERFACE — an admin's own profile, and the driver verification actions.
 *
 * Unlike the customer and driver controllers, these handlers act on OTHER people's records, so
 * the subject arrives in the path. The admin's own id still comes from `req.principal` and is
 * never taken from the request — it is what every audit entry is attributed to, and an
 * attributable-to-anyone audit log is not an audit log.
 */

function actorId(req: Request): string {
  const id = req.principal?.sub;
  if (id === undefined) throw AppError.unauthenticated();
  return id;
}

function mapDriverProfileToDto(driver: DriverProfile, profilePictureUrl: string | null = null): DriverProfileDto {
  return {
    id: driver.id,
    mobile_number: driver.mobileNumber,
    full_name: driver.fullName,
    // The profile picture field in the DTO should probably contain the fully resolved URL.
    // If not passed, we default to the raw db string (though usually we want to resolve it).
    profile_picture: profilePictureUrl ?? driver.profilePicture,
    dob: driver.dob ? driver.dob.toISOString().split('T')[0]! : null,
    gender: driver.gender,
    experience_years: driver.experienceYears,
    alternate_number: driver.alternatePhone,
    emergency_contact: driver.emergencyContact
      ? { name: driver.emergencyContact.name, number: driver.emergencyContact.phone }
      : null,
    address: driver.address,
    vehicle_type_preferences: driver.vehicleTypePreferences,
    vehicle_category_preference: driver.vehicleCategoryPreference,
    can_drive_hill: driver.canDriveHill,
    can_drive_hill_verified: driver.canDriveHillVerified,
    onboarding_status: driver.onboardingStatus,
    onboarding_rejection_reason: driver.onboardingRejectionReason,
    is_verified: driver.isVerified,
    is_on_duty: driver.isOnDuty,
  };
}

function mapDriverDocumentToDto(doc: DriverDocument, url: string = ''): DriverDocumentDto {
  return {
    id: doc.id,
    doc_type: doc.docType,
    side: doc.side,
    status: doc.status,
    rejection_reason: doc.rejectionReason,
    number: doc.number,
    sub_type: doc.subType,
    issued_on: doc.issuedOn ? doc.issuedOn.toISOString().split('T')[0]! : null,
    expires_on: doc.expiresOn ? doc.expiresOn.toISOString().split('T')[0]! : null,
    url
  };
}

/** Dates cross the wire as `YYYY-MM-DD`; timestamps as full ISO. Two different things. */
function toDateOnly(d: Date | null): string | null {
  return d === null ? null : (d.toISOString().split('T')[0] ?? null);
}

function fromDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function mapAddressToDto(a: SavedAddress): SavedAddressDto {
  return {
    id: a.id,
    label: a.label,
    address: a.address,
    lat: a.lat,
    lng: a.lng,
    is_default: a.isDefault,
    is_preferred_pickup: a.isPreferredPickup,
  };
}

function mapVehicleToDto(v: Vehicle): VehicleDto {
  return {
    id: v.id,
    category: v.category,
    plate_number: v.plateNumber,
    fuel_type: v.fuelType,
    is_default: v.isDefault,
  };
}

/**
 * The one vehicle the list column shows: the default, or the first if none is marked.
 *
 * The fallback matters — `defaultsForFirstVehicle` only marks a default when the FIRST vehicle is
 * saved, so a customer whose records predate that rule can own cars with no default among them.
 * An empty "Car number" for a customer who plainly has one reads as a data bug.
 */
function primaryVehicle(vehicles: Vehicle[]): Vehicle | undefined {
  return vehicles.find((v) => v.isDefault) ?? vehicles[0];
}

/** Same shape of choice for the location cell: where they are picked up, else their default. */
function primaryAddress(addresses: SavedAddress[]): SavedAddress | undefined {
  return (
    addresses.find((a) => a.isPreferredPickup) ?? addresses.find((a) => a.isDefault) ?? addresses[0]
  );
}

function mapCustomerToListItemDto(c: CustomerProfile): AdminCustomerListItemDto {
  const vehicle = primaryVehicle(c.vehicles);
  const address = primaryAddress(c.savedAddresses);

  return {
    id: c.id,
    full_name: c.fullName,
    mobile_number: c.mobileNumber,
    joined_at: c.joinedAt.toISOString(),
    car_number: vehicle?.plateNumber ?? null,
    other_vehicle_count: Math.max(0, c.vehicles.length - 1),
    location: address?.address ?? null,
    /**
     * Hard-coded null until the bookings and ratings modules exist (tier 6). Shipping the fields
     * now means the column, the DTO and the renderer are written once; when there is a booking
     * history to read, these two lines are the only ones that change.
     */
    last_ride_at: null,
    rating: null,
    is_blocked: c.isBlocked,
  };
}

function mapCustomerToDetailsDto(c: CustomerProfile): AdminCustomerDetailsDto {
  return {
    id: c.id,
    mobile_number: c.mobileNumber,
    full_name: c.fullName,
    dob: toDateOnly(c.dob),
    gender: c.gender,
    languages_known: c.languagesKnown,
    alternate_number: c.alternatePhone,
    emergency_contact:
      c.emergencyContact === null
        ? null
        : { name: c.emergencyContact.name, number: c.emergencyContact.phone },
    saved_addresses: c.savedAddresses.map(mapAddressToDto),
    vehicles: c.vehicles.map(mapVehicleToDto),
    joined_at: c.joinedAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
    is_blocked: c.isBlocked,
    last_ride_at: null,
    rating: null,
  };
}

export interface AdminControllerDeps {
  profile: ManageAdminProfileUseCase;
  verifyDriver: VerifyDriverUseCase;
  listDrivers: ListDriversAdminUseCase;
  getDriverDetails: GetDriverDetailsAdminUseCase;
  listCustomers: ListCustomersAdminUseCase;
  manageCustomer: ManageCustomerAdminUseCase;
}

export interface AdminControllers {
  getProfile: RequestHandler;
  updateProfile: RequestHandler;
  approveDriver: RequestHandler;
  rejectDriver: RequestHandler;
  reviewDocument: RequestHandler;
  listDrivers: RequestHandler;
  getDriverDetails: RequestHandler;
  getDriverDutyHistory: RequestHandler;
  listCustomers: RequestHandler;
  getCustomerDetails: RequestHandler;
  updateCustomer: RequestHandler;
}

export function makeAdminControllers(deps: AdminControllerDeps): AdminControllers {
  return {
    getProfile: asyncHandler(async (req, res) => {
      const profile = await deps.profile.get(actorId(req));
      const body: AdminProfileDto = {
        id: profile.id,
        mobile_number: profile.mobileNumber,
        full_name: profile.fullName,
      };
      sendSuccess(req, res, body, 'Profile');
    }),

    updateProfile: asyncHandler(async (req, res) => {
      const input = updateAdminProfileSchema.parse(req.body);
      const updated = await deps.profile.update(actorId(req), {
        ...(input.full_name === undefined ? {} : { fullName: input.full_name }),
      });
      const body: AdminProfileDto = {
        id: updated.id,
        mobile_number: updated.mobileNumber,
        full_name: updated.fullName,
      };
      sendSuccess(req, res, body, 'Profile updated');
    }),

    approveDriver: asyncHandler(async (req, res) => {
      const driver = await deps.verifyDriver.approve(req.params['id'] ?? '', {
        adminId: actorId(req),
        ip: req.ip,
      });
      const body: ApproveDriverResponse = {
        onboarding_status: driver.onboardingStatus,
        is_verified: driver.isVerified,
      };
      sendSuccess(req, res, body, 'Driver approved');
    }),

    rejectDriver: asyncHandler(async (req, res) => {
      const input = rejectDriverSchema.parse(req.body);
      const driver = await deps.verifyDriver.reject(req.params['id'] ?? '', input.reason, {
        adminId: actorId(req),
        ip: req.ip,
      });
      const body: RejectDriverResponse = { onboarding_status: driver.onboardingStatus };
      sendSuccess(req, res, body, 'Driver rejected');
    }),

    reviewDocument: asyncHandler(async (req, res) => {
      const input = reviewDocumentSchema.parse(req.body);
      const document = await deps.verifyDriver.reviewDocument(
        req.params['docId'] ?? '',
        input.status,
        input.reason,
        { adminId: actorId(req), ip: req.ip },
      );
      const body: ReviewDocumentResponse = { document_id: document.id, status: document.status };
      sendSuccess(req, res, body, 'Document reviewed');
    }),

    listDrivers: asyncHandler(async (req, res) => {
      const input = adminDriverListQuerySchema.parse(req.query);

      const filter: Parameters<typeof deps.listDrivers.execute>[0] = {};
      if (input.onboarding_status !== undefined) filter.onboardingStatus = input.onboarding_status;
      if (input.is_verified !== undefined) filter.isVerified = input.is_verified;
      if (input.search !== undefined) filter.search = input.search;

      const { drivers, totalItems } = await deps.listDrivers.execute(
        filter,
        input.page,
        input.limit
      );

      const body: AdminDriverListDto = {
        drivers: drivers.map(d => mapDriverProfileToDto(d)),
        pagination: {
          page: input.page,
          limit: input.limit,
          total_items: totalItems,
          total_pages: Math.ceil(totalItems / input.limit),
        },
      };
      sendSuccess(req, res, body, 'Drivers listed');
    }),

    getDriverDetails: asyncHandler(async (req, res) => {
      const { id } = driverIdParamSchema.parse(req.params);
      const { profile, documents } = await deps.getDriverDetails.execute(id);

      const body: AdminDriverDetailsDto = {
        profile: mapDriverProfileToDto(profile, profile.profilePictureUrl),
        documents: documents.map((doc) => mapDriverDocumentToDto(doc, doc.url)),
      };
      sendSuccess(req, res, body, 'Driver details retrieved');
    }),

    getDriverDutyHistory: asyncHandler(async (req, res) => {
      const { id } = driverIdParamSchema.parse(req.params);

      // Return empty real data until the dispatch/duty module is integrated
      const body: AdminDriverDutyHistoryDto = {
        sessions: [],
        pagination: {
          page: 1,
          limit: 10,
          total_items: 0,
          total_pages: 1,
        },
      };

      sendSuccess(req, res, body, 'Driver duty history retrieved');
    }),

    listCustomers: asyncHandler(async (req, res) => {
      const input = adminCustomerListQuerySchema.parse(req.query);

      const filter: Parameters<typeof deps.listCustomers.execute>[0] = {};
      if (input.search !== undefined) filter.search = input.search;
      if (input.is_blocked !== undefined) filter.isBlocked = input.is_blocked;

      const { customers, totalItems } = await deps.listCustomers.execute(
        filter,
        input.page,
        input.limit,
      );

      const body: AdminCustomerListDto = {
        customers: customers.map(mapCustomerToListItemDto),
        pagination: {
          page: input.page,
          limit: input.limit,
          total_items: totalItems,
          total_pages: Math.ceil(totalItems / input.limit),
        },
      };
      sendSuccess(req, res, body, 'Customers listed');
    }),

    getCustomerDetails: asyncHandler(async (req, res) => {
      const { id } = customerIdParamSchema.parse(req.params);
      const customer = await deps.manageCustomer.get(id);
      sendSuccess(req, res, mapCustomerToDetailsDto(customer), 'Customer details retrieved');
    }),

    updateCustomer: asyncHandler(async (req, res) => {
      const { id } = customerIdParamSchema.parse(req.params);
      const input = adminUpdateCustomerSchema.parse(req.body);

      // Each field is forwarded only when the request MENTIONED it. Spreading `input` directly
      // would hand the use case a key for every field, and its audit `changedFields` reads that
      // same patch to decide what to log — so a one-field edit would record five.
      const updated = await deps.manageCustomer.update(
        id,
        {
          ...(input.full_name === undefined ? {} : { fullName: input.full_name }),
          ...(input.dob === undefined
            ? {}
            : { dob: input.dob === null ? null : fromDateOnly(input.dob) }),
          ...(input.gender === undefined ? {} : { gender: input.gender }),
          ...(input.alternate_number === undefined
            ? {}
            : { alternatePhone: input.alternate_number }),
          ...(input.is_blocked === undefined ? {} : { isBlocked: input.is_blocked }),
        },
        { adminId: actorId(req), ip: req.ip },
      );

      sendSuccess(req, res, mapCustomerToDetailsDto(updated), 'Customer updated');
    }),
  };
}

