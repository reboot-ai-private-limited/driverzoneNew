import type { CarCategory, VehicleTypePreference } from '@driverzone/contracts';
import type { Booking } from '../../bookings/bookings.public.js';

/**
 * THE SAME COMPETENCY GATE `MongoDriverPool` applies during a wave (see its comments there),
 * pulled out so MANUAL ASSIGNMENT — the one path that bypasses the pool entirely — can apply it
 * too. One function, two callers (the hard check in `TransferBookingUseCase` and the picker
 * annotation in `dispatch.controller.ts`), so the two can never quietly drift apart.
 *
 * EXACT MATCH ON BOTH, and no fallback: a driver who has not declared a category is not treated
 * as able to drive it, and a booking with no requirement (rows written before 2026-09-02) is
 * treated as satisfied by anyone. Matches `MongoDriverPool.findEligible`'s reading exactly.
 */
export interface VehicleCompetency {
  vehicleCategoryPreference: readonly CarCategory[];
  vehicleTypePreferences: readonly VehicleTypePreference[];
  canDriveHillVerified: boolean;
}

export interface VehicleRequirement {
  carCategory: CarCategory | null;
  vehicleType: VehicleTypePreference | null;
  requireHillVerified: boolean;
}

/** The first reason the driver does not meet the trip's requirement, or null when they do. */
export function vehicleMismatchReason(
  driver: VehicleCompetency,
  requirement: VehicleRequirement,
): 'CATEGORY' | 'TYPE' | 'HILL' | null {
  if (
    requirement.carCategory !== null &&
    !driver.vehicleCategoryPreference.includes(requirement.carCategory)
  ) {
    return 'CATEGORY';
  }

  if (
    requirement.vehicleType !== null &&
    !driver.vehicleTypePreferences.includes(requirement.vehicleType)
  ) {
    return 'TYPE';
  }

  if (requirement.requireHillVerified && !driver.canDriveHillVerified) {
    return 'HILL';
  }

  return null;
}

/** What a booking requires of whoever drives it — the same shape `runWave.usecase.ts` builds. */
export function requirementFromBooking(
  booking: Pick<Booking, 'carCategory' | 'vehicleType' | 'fareSnapshot'>,
): VehicleRequirement {
  return {
    carCategory: booking.carCategory,
    vehicleType: booking.vehicleType,
    requireHillVerified: booking.fareSnapshot.source.terrain === 'HILL',
  };
}
