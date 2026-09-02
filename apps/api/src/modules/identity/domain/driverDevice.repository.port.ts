/**
 * DOMAIN — where a driver's handsets are reachable.
 *
 * Kept apart from `DriverProfileRepositoryPort` because these are not profile fields: they are
 * transport addresses with their own lifecycle. A token is added on sign-in, rotated by FCM
 * without asking, and removed only when a send proves it dead — none of which resembles a driver
 * editing their own record.
 */
export interface DriverDeviceRepositoryPort {
  /**
   * Idempotent. FCM hands the app the same token on every launch, so the common case is
   * re-registering something already stored, and that must not create a duplicate.
   */
  register(driverId: string, fcmToken: string): Promise<void>;

  /** Every token to ring for this driver. Empty means unreachable — a `NONE` delivery. */
  tokensFor(driverId: string): Promise<string[]>;

  /**
   * Drop a token FCM has told us is dead (`registration-token-not-registered`).
   *
   * Scoped to one token rather than one driver: the same dead token can be attached to several
   * drivers if a phone was handed over, and all of those are equally wrong.
   */
  remove(fcmToken: string): Promise<void>;

  /** Sign-out. Removes just this handset, leaving the driver's other devices registered. */
  removeForDriver(driverId: string, fcmToken: string): Promise<void>;
}
