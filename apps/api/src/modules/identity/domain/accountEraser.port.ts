/**
 * PORT — close a customer or driver account and erase the personal data on it.
 *
 * ANONYMISE, NOT DELETE. Bookings, payments, wallet and ledger rows point at this account and are
 * records the business must keep (tax, disputes). So the row stays, emptied: name, contact
 * details, addresses, vehicles, photo, documents and device tokens go; the id and the aggregates
 * that describe no one (rating, trip count) stay. What is erased is exactly what the public
 * `/delete-account` page promises.
 *
 * `phone` becomes `deleted:<id>`, which does two jobs at once: the real number can no longer sign
 * in to this row, and it is free to start a brand-new, empty account.
 */
export interface ErasedAccount {
  /** Storage keys that were attached, for the caller to remove from the file store. */
  privateFileKeys: string[];
  publicFileKeys: string[];
}

export interface AccountEraserPort {
  /**
   * Erases in one conditional write — a second call, or a race with another, finds `deletedAt`
   * already set and resolves `undefined`, erasing nothing twice.
   */
  eraseCustomer(customerId: string, at: Date): Promise<ErasedAccount | undefined>;

  /** Also removes every driver document row; their files come back in `privateFileKeys`. */
  eraseDriver(driverId: string, at: Date): Promise<ErasedAccount | undefined>;
}
