/**
 * DOMAIN — where a customer's handsets are reachable for ride-update push.
 *
 * A near-copy of `DriverDeviceRepositoryPort`. Kept as its own port rather than shared because
 * the two lifecycles differ: a driver's token is kept across shifts (dispatch filters on
 * `isOnDuty` instead), while a customer's is withdrawn on sign-out — a shared phone must not keep
 * delivering the previous account's trips.
 */
export interface CustomerDeviceRepositoryPort {
  /** Idempotent — FCM hands the app the same token on every launch. */
  register(customerId: string, fcmToken: string): Promise<void>;

  /** Every token to notify for this customer. Empty means unreachable. */
  tokensFor(customerId: string): Promise<string[]>;

  /**
   * Drop a token FCM has told us is dead (`registration-token-not-registered`). Scoped to the
   * token across all customers, since a handed-over phone leaves the same dead token on several.
   */
  remove(fcmToken: string): Promise<void>;

  /** Sign-out — removes just this handset, leaving the customer's other devices registered. */
  removeForCustomer(customerId: string, fcmToken: string): Promise<void>;
}
