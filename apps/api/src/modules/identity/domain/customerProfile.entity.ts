import type { AddressLabel, FuelType } from '@driverzone/contracts';

/**
 * DOMAIN — the rules governing a customer's saved addresses and vehicles.
 *
 * Every function here is pure: a list goes in, a new list comes out. No repository, no ids
 * generated, no clock. That is what makes the "only one default" invariant — the rule most
 * likely to break under a partial update — testable exhaustively in milliseconds.
 */

export interface SavedAddress {
  id: string;
  label: AddressLabel;
  address: string;
  lat: number;
  lng: number;
  isDefault: boolean;
  isPreferredPickup: boolean;
}

export interface Vehicle {
  id: string;
  category: string;
  plateNumber: string;
  fuelType: FuelType | null;
  isDefault: boolean;
}

/**
 * Coordinates are rounded to four decimal places — about 11 metres — before comparison.
 *
 * Two "home" pins dropped by hand on consecutive bookings are never bit-identical, so an exact
 * match would file a new address every trip and the customer's address book would fill with
 * near-duplicates of one place. 11 m comfortably covers hand-placed pin drift and ordinary GPS
 * error on a phone.
 *
 * The next step out (3dp, ~110 m) would start merging genuinely different addresses on the same
 * street; the step in (5dp, ~1 m) is tighter than a person can place a pin twice, which is the
 * bug this constant exists to prevent.
 *
 * Rounding has boundary cases — two points 2 m apart can straddle a rounding edge and read as
 * different. That failure direction is the benign one: an occasional duplicate the customer can
 * delete, rather than two distinct addresses silently collapsed into one.
 */
const COORDINATE_MATCH_DP = 4;

function coordinateKey(lat: number, lng: number): string {
  return `${lat.toFixed(COORDINATE_MATCH_DP)},${lng.toFixed(COORDINATE_MATCH_DP)}`;
}

/**
 * Plates are compared case-insensitively with separators stripped: `WB 74 AB-1234`, `wb74ab1234`
 * and `WB74AB1234` are one car. Without this the save-at-booking upsert files a new vehicle
 * every time the customer types their plate slightly differently.
 */
export function normalisePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Enforces "at most one default" across a list.
 *
 * `isDefault` and `isPreferredPickup` are cleared INDEPENDENTLY, which is the whole point of
 * them being two flags: a customer may default to their office address in the address book
 * while still preferring pickup from home (docs/LLD/13-auth-and-user.md §Customer). Collapsing
 * them into one field would make that unrepresentable.
 */
export function applyAddressFlags(addresses: SavedAddress[], winnerId: string): SavedAddress[] {
  const winner = addresses.find((a) => a.id === winnerId);
  if (winner === undefined) return addresses;

  return addresses.map((a) => {
    if (a.id === winnerId) return a;
    return {
      ...a,
      isDefault: winner.isDefault ? false : a.isDefault,
      isPreferredPickup: winner.isPreferredPickup ? false : a.isPreferredPickup,
    };
  });
}

export function applyVehicleFlags(vehicles: Vehicle[], winnerId: string): Vehicle[] {
  const winner = vehicles.find((v) => v.id === winnerId);
  if (winner === undefined || !winner.isDefault) return vehicles;

  return vehicles.map((v) => (v.id === winnerId ? v : { ...v, isDefault: false }));
}

/**
 * The FIRST address a customer saves becomes their default and preferred pickup automatically.
 *
 * Without this, a customer with exactly one saved address has no default, and the booking flow
 * prefills nothing despite there being only one possible answer. Applies only to the first —
 * after that, silently promoting things would fight the customer's own choices.
 */
export function defaultsForFirstAddress(existingCount: number): {
  isDefault: boolean;
  isPreferredPickup: boolean;
} {
  const first = existingCount === 0;
  return { isDefault: first, isPreferredPickup: first };
}

export function defaultsForFirstVehicle(existingCount: number): { isDefault: boolean } {
  return { isDefault: existingCount === 0 };
}

/**
 * Finds an existing address at the same place, for the save-at-booking upsert.
 *
 * Matching on POSITION rather than on the address string, because the same place arrives with
 * different text every time — geocoders disagree, and customers edit the label. The coordinates
 * are the thing that actually identifies the location.
 */
export function findAddressAtSamePlace(
  addresses: SavedAddress[],
  lat: number,
  lng: number,
): SavedAddress | undefined {
  const key = coordinateKey(lat, lng);
  return addresses.find((a) => coordinateKey(a.lat, a.lng) === key);
}

export function findVehicleByPlate(vehicles: Vehicle[], plateNumber: string): Vehicle | undefined {
  const key = normalisePlate(plateNumber);
  return vehicles.find((v) => normalisePlate(v.plateNumber) === key);
}
