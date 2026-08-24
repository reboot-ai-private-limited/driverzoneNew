import type { FuelType } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { newVehicleId } from '@/shared/ids.js';
import {
  applyVehicleFlags,
  defaultsForFirstVehicle,
  findVehicleByPlate,
} from '../../domain/customerProfile.entity.js';
import type { Vehicle } from '../../domain/customerProfile.entity.js';
import type { CustomerProfileRepositoryPort } from '../../domain/customerProfile.repository.port.js';

export interface AddVehicleInput {
  category: string;
  plateNumber: string;
  fuelType?: FuelType | undefined;
  isDefault?: boolean | undefined;
}

export type UpdateVehicleInput = Partial<AddVehicleInput>;

/**
 * APPLICATION — a customer's own cars.
 *
 * Same read-modify-write shape as `ManageAddressesUseCase`, and grouped for the same reason.
 *
 * These are the CUSTOMER's vehicles: the driver drives the customer's car rather than supplying
 * one (docs/LLD/open-questions.md Q5), which is why this lives on the customer profile and
 * why `category` is free text rather than a car-category reference.
 */
export class ManageVehiclesUseCase {
  constructor(private readonly customers: CustomerProfileRepositoryPort) {}

  private async load(customerId: string): Promise<Vehicle[]> {
    const profile = await this.customers.findById(customerId);
    if (profile === undefined) throw AppError.notFound('Your profile could not be found.');
    return profile.vehicles;
  }

  async add(customerId: string, input: AddVehicleInput): Promise<Vehicle> {
    const existing = await this.load(customerId);

    // Same plate twice is the same car — almost always a double-tapped Save, and a duplicate
    // would make "which of these two identical cars" a question the customer has to answer at
    // every booking.
    const duplicate = findVehicleByPlate(existing, input.plateNumber);
    if (duplicate !== undefined) {
      throw AppError.conflict('That vehicle is already saved.', { vehicle_id: duplicate.id });
    }

    const created: Vehicle = {
      id: newVehicleId(),
      category: input.category,
      plateNumber: input.plateNumber,
      fuelType: input.fuelType ?? null,
      isDefault: input.isDefault ?? defaultsForFirstVehicle(existing.length).isDefault,
    };

    const next = applyVehicleFlags([...existing, created], created.id);
    const saved = await this.customers.replaceVehicles(customerId, next);

    const result = saved.find((v) => v.id === created.id);
    if (result === undefined) throw AppError.internal('INTERNAL', { reason: 'vehicle vanished on write' });
    return result;
  }

  async update(customerId: string, vehicleId: string, input: UpdateVehicleInput): Promise<Vehicle> {
    const existing = await this.load(customerId);
    if (!existing.some((v) => v.id === vehicleId)) throw AppError.notFound('That vehicle could not be found.');

    // A plate change must not collide with a DIFFERENT saved vehicle; matching itself is fine.
    if (input.plateNumber !== undefined) {
      const clash = findVehicleByPlate(existing, input.plateNumber);
      if (clash !== undefined && clash.id !== vehicleId) {
        throw AppError.conflict('Another saved vehicle already uses that number plate.');
      }
    }

    const merged = existing.map((v) =>
      v.id === vehicleId
        ? {
            ...v,
            ...(input.category === undefined ? {} : { category: input.category }),
            ...(input.plateNumber === undefined ? {} : { plateNumber: input.plateNumber }),
            ...(input.fuelType === undefined ? {} : { fuelType: input.fuelType }),
            ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
          }
        : v,
    );

    const next = applyVehicleFlags(merged, vehicleId);
    const saved = await this.customers.replaceVehicles(customerId, next);

    const result = saved.find((v) => v.id === vehicleId);
    if (result === undefined) throw AppError.notFound('That vehicle could not be found.');
    return result;
  }

  async remove(customerId: string, vehicleId: string): Promise<void> {
    const existing = await this.load(customerId);
    const removed = existing.find((v) => v.id === vehicleId);
    if (removed === undefined) throw AppError.notFound('That vehicle could not be found.');

    const remaining = existing.filter((v) => v.id !== vehicleId);

    // Promote a survivor, so a customer with cars is never left without a default.
    const first = remaining[0];
    if (removed.isDefault && first !== undefined) first.isDefault = true;

    await this.customers.replaceVehicles(customerId, remaining);
  }
}
