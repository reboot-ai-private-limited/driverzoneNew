import type { Request, RequestHandler } from 'express';
import type {
  CustomerProfileDto,
  RegisterDeviceResponse,
  SavedAddressDto,
  VehicleDto,
} from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { SavedAddress, Vehicle } from '../domain/customerProfile.entity.js';
import type { CustomerProfile } from '../domain/customerProfile.repository.port.js';
import type { GetCustomerProfileUseCase } from '../application/useCases/getCustomerProfile.usecase.js';
import type { UpdateCustomerProfileUseCase } from '../application/useCases/updateCustomerProfile.usecase.js';
import type { ManageAddressesUseCase } from '../application/useCases/manageAddresses.usecase.js';
import type { ManageVehiclesUseCase } from '../application/useCases/manageVehicles.usecase.js';
import type { CustomerDeviceRepositoryPort } from '../domain/customerDevice.repository.port.js';
import {
  createAddressSchema,
  createVehicleSchema,
  deleteDeviceSchema,
  registerDeviceSchema,
  updateAddressSchema,
  updateCustomerProfileSchema,
  updateVehicleSchema,
} from './identity.validation.js';

/**
 * INTERFACE — the customer's own profile, addresses and vehicles.
 *
 * Every handler reads the subject from `req.principal`, which `requireAuth('CUSTOMER')` put
 * there after verifying the token. No handler takes a customer id from the path or body: a
 * customer may only ever act on themselves, and the surest way to guarantee that is to give the
 * route no way to name anyone else.
 */

/** Dates cross the wire as `YYYY-MM-DD`, never as a full ISO timestamp with a spurious 00:00Z. */
function toDateOnly(d: Date | null): string | null {
  return d === null ? null : (d.toISOString().split('T')[0] ?? null);
}

/** Parses a `YYYY-MM-DD` the schema already validated. */
function fromDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function addressToDto(a: SavedAddress): SavedAddressDto {
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

function vehicleToDto(v: Vehicle): VehicleDto {
  return {
    id: v.id,
    category: v.category,
    plate_number: v.plateNumber,
    fuel_type: v.fuelType,
    is_default: v.isDefault,
  };
}

function profileToDto(p: CustomerProfile): CustomerProfileDto {
  return {
    id: p.id,
    mobile_number: p.mobileNumber,
    full_name: p.fullName,
    dob: toDateOnly(p.dob),
    gender: p.gender,
    languages_known: p.languagesKnown,
    alternate_number: p.alternatePhone,
    emergency_contact:
      p.emergencyContact === null
        ? null
        : { name: p.emergencyContact.name, number: p.emergencyContact.phone },
    saved_addresses: p.savedAddresses.map(addressToDto),
    vehicles: p.vehicles.map(vehicleToDto),
  };
}

/**
 * The authenticated subject's id.
 *
 * Throws rather than returning undefined: reaching a controller with no principal means the
 * route was mounted without `requireAuth`, which is a wiring bug that must fail loudly rather
 * than fall through to "act on nobody".
 */
function subjectId(req: Request): string {
  const id = req.principal?.sub;
  if (id === undefined) throw AppError.unauthenticated();
  return id;
}

export interface CustomerControllerDeps {
  getProfile: GetCustomerProfileUseCase;
  updateProfile: UpdateCustomerProfileUseCase;
  addresses: ManageAddressesUseCase;
  vehicles: ManageVehiclesUseCase;
  devices: CustomerDeviceRepositoryPort;
}

export interface CustomerControllers {
  getProfile: RequestHandler;
  updateProfile: RequestHandler;
  addAddress: RequestHandler;
  updateAddress: RequestHandler;
  removeAddress: RequestHandler;
  addVehicle: RequestHandler;
  updateVehicle: RequestHandler;
  removeVehicle: RequestHandler;
  registerDevice: RequestHandler;
  removeDevice: RequestHandler;
}

export function makeCustomerControllers(deps: CustomerControllerDeps): CustomerControllers {
  return {
    getProfile: asyncHandler(async (req, res) => {
      const profile = await deps.getProfile.execute(subjectId(req));
      sendSuccess(req, res, profileToDto(profile), 'Profile');
    }),

    updateProfile: asyncHandler(async (req, res) => {
      const input = updateCustomerProfileSchema.parse(req.body);

      // Each key is forwarded only when present, so an omitted field is left alone and an
      // explicit null clears it — the two intents the patch type exists to keep apart.
      const updated = await deps.updateProfile.execute(subjectId(req), {
        ...(input.full_name === undefined ? {} : { fullName: input.full_name }),
        ...(input.dob === undefined ? {} : { dob: input.dob === null ? null : fromDateOnly(input.dob) }),
        ...(input.gender === undefined ? {} : { gender: input.gender }),
        ...(input.languages_known === undefined ? {} : { languagesKnown: input.languages_known }),
        ...(input.alternate_number === undefined ? {} : { alternatePhone: input.alternate_number }),
        ...(input.emergency_contact === undefined
          ? {}
          : {
              emergencyContact:
                input.emergency_contact === null
                  ? null
                  : { name: input.emergency_contact.name, phone: input.emergency_contact.number },
            }),
      });

      sendSuccess(req, res, profileToDto(updated), 'Profile updated');
    }),

    addAddress: asyncHandler(async (req, res) => {
      const input = createAddressSchema.parse(req.body);
      const created = await deps.addresses.add(subjectId(req), {
        label: input.label,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
        isDefault: input.is_default,
        isPreferredPickup: input.is_preferred_pickup,
      });
      sendSuccess(req, res, addressToDto(created), 'Address saved', 201);
    }),

    updateAddress: asyncHandler(async (req, res) => {
      const input = updateAddressSchema.parse(req.body);
      const updated = await deps.addresses.update(subjectId(req), req.params['id'] ?? '', {
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.address === undefined ? {} : { address: input.address }),
        ...(input.lat === undefined ? {} : { lat: input.lat }),
        ...(input.lng === undefined ? {} : { lng: input.lng }),
        ...(input.is_default === undefined ? {} : { isDefault: input.is_default }),
        ...(input.is_preferred_pickup === undefined ? {} : { isPreferredPickup: input.is_preferred_pickup }),
      });
      sendSuccess(req, res, addressToDto(updated), 'Address updated');
    }),

    removeAddress: asyncHandler(async (req, res) => {
      await deps.addresses.remove(subjectId(req), req.params['id'] ?? '');
      sendSuccess(req, res, { deleted: true }, 'Address removed');
    }),

    addVehicle: asyncHandler(async (req, res) => {
      const input = createVehicleSchema.parse(req.body);
      const created = await deps.vehicles.add(subjectId(req), {
        category: input.category,
        plateNumber: input.plate_number,
        fuelType: input.fuel_type,
        isDefault: input.is_default,
      });
      sendSuccess(req, res, vehicleToDto(created), 'Vehicle saved', 201);
    }),

    updateVehicle: asyncHandler(async (req, res) => {
      const input = updateVehicleSchema.parse(req.body);
      const updated = await deps.vehicles.update(subjectId(req), req.params['id'] ?? '', {
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.plate_number === undefined ? {} : { plateNumber: input.plate_number }),
        ...(input.fuel_type === undefined ? {} : { fuelType: input.fuel_type }),
        ...(input.is_default === undefined ? {} : { isDefault: input.is_default }),
      });
      sendSuccess(req, res, vehicleToDto(updated), 'Vehicle updated');
    }),

    removeVehicle: asyncHandler(async (req, res) => {
      await deps.vehicles.remove(subjectId(req), req.params['id'] ?? '');
      sendSuccess(req, res, { deleted: true }, 'Vehicle removed');
    }),

    registerDevice: asyncHandler(async (req, res) => {
      const input = registerDeviceSchema.parse(req.body);
      await deps.devices.register(subjectId(req), input.fcm_token);
      const body: RegisterDeviceResponse = { registered: true };
      sendSuccess(req, res, body, 'Device registered');
    }),

    removeDevice: asyncHandler(async (req, res) => {
      const input = deleteDeviceSchema.parse(req.body);
      await deps.devices.removeForCustomer(subjectId(req), input.fcm_token);
      sendSuccess(req, res, { deleted: true }, 'Device removed');
    }),
  };
}
